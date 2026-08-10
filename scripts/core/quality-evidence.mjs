import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { containsSecretMaterial } from "./security.mjs";
import { CONTRACT_VERSION, sha256, stableJson } from "./contracts.mjs";
import { isFailure, run } from "../lib.mjs";

export const QUALITY_CHECK_KIND = "gitflow-sentinel/quality-check";
export const QUALITY_EVIDENCE_KIND = "gitflow-sentinel/quality-evidence";

function gitValue(root, args) {
  const result = run("git", ["-C", root, ...args], root);
  return isFailure(result) ? "" : String(result).trim();
}

function statusHash(root) {
  const value = run("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], root);
  if (isFailure(value)) throw new Error("Quality evidence requires a readable Git repository.");
  return sha256(String(value));
}

function gitDirectory(root) {
  const value = gitValue(root, ["rev-parse", "--absolute-git-dir"]);
  if (!value) throw new Error("Quality evidence requires a Git repository.");
  return path.resolve(value);
}

function storeDirectory(root) {
  return path.join(gitDirectory(root), "sentinel", "quality-evidence");
}

function quoteArgument(value) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value);
}

export function commandDisplay(argv) {
  return argv.map((value) => quoteArgument(String(value))).join(" ");
}

function currentState(root) {
  return {
    head: gitValue(root, ["rev-parse", "HEAD"]),
    branch: gitValue(root, ["branch", "--show-current"]),
    statusHash: statusHash(root),
  };
}

function windowsBatchFile(command, cwd) {
  if (process.platform !== "win32") return "";

  const explicit = path.isAbsolute(command) || /[\\/]/.test(command);
  const candidates = explicit
    ? [path.resolve(cwd, command)]
    : (() => {
        const located = spawnSync("where.exe", [command], {
          cwd,
          encoding: "utf8",
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        if (located.error || located.status !== 0) return [];
        return String(located.stdout || "").split(/\r?\n/).filter(Boolean);
      })();

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate.replace(/^"|"$/g, ""));
    const extension = path.extname(resolved).toLowerCase();
    if (![".com", ".exe", ".bat", ".cmd"].includes(extension) || !existsSync(resolved)) continue;
    return extension === ".bat" || extension === ".cmd" ? resolved : "";
  }
  return "";
}

function runApprovedCommand(argv, options) {
  const batchFile = windowsBatchFile(argv[0], options.cwd);
  if (!batchFile) return spawnSync(argv[0], argv.slice(1), options);

  const values = [batchFile, ...argv.slice(1)].map(String);
  if (values.some((value) => /["%\r\n\0]/.test(value))) {
    throw new Error("Windows command-shim paths and arguments cannot contain quotes, percent signs, or control characters.");
  }
  const commandLine = `"${values.map((value) => `"${value}"`).join(" ")}"`;

  return spawnSync(process.env.ComSpec || "cmd.exe", [
    "/d",
    "/s",
    "/v:off",
    "/c",
    commandLine,
  ], { ...options, windowsVerbatimArguments: true });
}

export function createQualityCheck(root, argv) {
  const command = (argv || []).map(String);
  if (!command.length || !command[0]) throw new Error("A command is required after --.");
  if (containsSecretMaterial(JSON.stringify(command))) {
    throw new Error("The quality command contains secret-like material; use environment or provider secrets instead.");
  }
  const value = {
    kind: QUALITY_CHECK_KIND,
    schemaVersion: CONTRACT_VERSION,
    root: path.resolve(root),
    command: commandDisplay(command),
    argv: command,
    state: currentState(root),
    risk: "R2",
  };
  return { ...value, hash: sha256(stableJson(value)) };
}

export function executeQualityCheck(check, {
  approval,
  timeoutMs = 300_000,
} = {}) {
  if (approval !== check.hash) throw new Error("Approval hash does not match the quality check.");
  const current = createQualityCheck(check.root, check.argv);
  if (current.hash !== check.hash) throw new Error("Quality check is stale: the repository state or command changed.");

  const started = Date.now();
  const result = runApprovedCommand(check.argv, {
    cwd: check.root,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  const durationMs = Date.now() - started;
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const after = currentState(check.root);
  if (stableJson(after) !== stableJson(check.state)) {
    throw new Error("Quality command changed the Git worktree; no verification evidence was recorded.");
  }
  if (result.error) throw new Error(`Quality command could not run: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Quality command failed with exit code ${result.status}; output digest ${sha256(output)}.`);
  }

  const evidence = {
    kind: QUALITY_EVIDENCE_KIND,
    schemaVersion: CONTRACT_VERSION,
    recordedAt: new Date().toISOString(),
    command: check.command,
    argv: check.argv,
    state: check.state,
    exitCode: result.status,
    durationMs,
    outputDigest: sha256(output),
  };
  evidence.hash = sha256(stableJson(evidence));
  const directory = storeDirectory(check.root);
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${sha256(check.command)}.json`);
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* POSIX modes are advisory on Windows. */ }
  return evidence;
}

export function listQualityEvidence(root) {
  let directory;
  try { directory = storeDirectory(root); } catch { return []; }
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        const value = JSON.parse(readFileSync(path.join(directory, name), "utf8"));
        if (value.kind !== QUALITY_EVIDENCE_KIND || value.schemaVersion !== CONTRACT_VERSION) return null;
        const copy = { ...value };
        delete copy.hash;
        return value.hash === sha256(stableJson(copy)) ? value : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
}

export function validQualityEvidence(root, snapshot, commands) {
  const evidence = listQualityEvidence(root);
  return Object.fromEntries((commands || []).map((command) => {
    const found = evidence.find((item) =>
      item.command === command &&
      item.exitCode === 0 &&
      item.state?.head === (snapshot.git.head || "") &&
      item.state?.branch === (snapshot.git.branch || "") &&
      item.state?.statusHash === (snapshot.git.statusHash || ""));
    return [command, found || null];
  }));
}
