// managed-by: gitflow-sentinel (skill tooling)
// Shared helpers for the install/doctor/verify/orchestrate scripts. Kept
// separate so each script stays focused on its own responsibility.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_NAME = "gitflow-sentinel";
export const MANAGED_MARKER = "managed-by: gitflow-sentinel";
export const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEMPLATE_ROOT = path.join(SKILL_ROOT, "assets", "templates");
export const RUNTIME_VERSION = readFileSync(
  path.join(TEMPLATE_ROOT, "runtime", ".gitflow-sentinel", "VERSION"),
  "utf8",
).trim();

export function run(command, args, cwd, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      input: options.input,
      timeout: options.timeout,
    }).trim();
  } catch (error) {
    const redact = (value) => String(value || "")
      .replace(/(https?:\/\/)[^/\s@]+@/gi, "$1<redacted>@")
      .replace(/([?&](?:access_token|token|secret|password|api[_-]?key)=)[^&#\s]+/gi, "$1<redacted>")
      .replace(/\b(?:AKIA[0-9A-Z]{16}|(?:gh[pousr]_|github_pat_|glpat-|sk-(?:proj-)?|xox[baprs]-|npm_)[A-Za-z0-9_-]{8,})\b/g, "<redacted-secret>")
      .trim();
    const stdout = redact(error.stdout);
    const stderr = redact(error.stderr);
    const safeError = {
      code: error.code,
      signal: error.signal,
      killed: error.killed,
      message: redact(error.message),
    };
    return { error: safeError, stdout, stderr, message: stderr || stdout || safeError.message };
  }
}

export function isFailure(value) {
  return typeof value === "object" && value?.error;
}

// True only when the command genuinely could not be found (ENOENT), as opposed
// to a spawn that failed for another reason (bad args, non-zero exit, a Windows
// .cmd/.ps1 shim execFileSync could not invoke without a shell). Callers use this
// to avoid printing a misleading "X not found" when X is installed and the
// failure was something else.
export function isNotFound(value) {
  return isFailure(value) && value.error?.code === "ENOENT";
}

// Consume the next argv value for a flag, rejecting a missing value or one that
// looks like another flag (`--project-root --apply` would otherwise silently
// swallow `--apply` as the path and make it vanish from parsing). Shared by
// every script's parseArgs so this validation only needs to be right once.
export function nextValue(argv, i, flagName) {
  const v = argv[i + 1];
  if (v === undefined || (v.startsWith("-") && v !== "-")) {
    throw new Error(`Missing value for ${flagName} (got ${v === undefined ? "nothing" : `'${v}'`}).`);
  }
  return v;
}

// Resolve and validate a --project-root value once, with a clear error instead
// of a downstream "not a git repository" or a confusing gh/git failure — useful
// with several drives in play (D:\, E:\...) where a typo'd or wrong-drive path
// is an easy mistake.
export function resolveProjectRoot(rawPath) {
  const root = path.resolve(rawPath || ".");
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Project root is not a directory: ${root}`);
  }
  return root;
}

export function normalizeRel(p) {
  return p.split(path.sep).join("/");
}

export function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

export function renderTemplate(content, ctx) {
  return content
    .replaceAll("{{GUARDRAILS_VERSION}}", ctx.guardrailsVersion ?? "")
    .replaceAll("{{PROJECT_NAME}}", ctx.projectName ?? "")
    .replaceAll("{{WORKTREE_ROOT}}", ctx.worktreeRoot ?? "")
    .replaceAll("{{OVERRIDE_MARKER}}", ctx.overrideMarker ?? "")
    .replaceAll("{{STABLE_BRANCH}}", ctx.stableBranch ?? "main")
    .replaceAll("{{INTEGRATION_BRANCH}}", ctx.integrationBranch ?? "dev")
    .replaceAll("{{LEGACY_BRANCH}}", ctx.legacyBranch ?? "master")
    .replaceAll("{{SHORT_PREFIXES}}", ctx.shortPrefixes ?? "feat, fix, docs, …");
}

export function readJsonSafe(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export async function writeText(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

let backupCounter = 0;
export function backupPath(target) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  // A per-process counter avoids two backups colliding within the same second.
  const tag = String(backupCounter++).padStart(2, "0");
  return `${target}.pre-${SKILL_NAME}-${stamp}-${tag}.bak`;
}

// Detect a pre-existing git hook manager so the installer can cooperate with it
// instead of fighting over core.hooksPath. Returns { name, hooksDir? } or null.
export function detectHookManager(root) {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  const prepare = pkg?.scripts?.prepare || "";
  if (/husky/.test(prepare) || existsSync(path.join(root, ".husky"))) {
    return { name: "husky", hooksDir: path.join(root, ".husky") };
  }
  if (["lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml"].some((f) => existsSync(path.join(root, f)))) {
    return { name: "lefthook" };
  }
  if (existsSync(path.join(root, ".pre-commit-config.yaml")) || existsSync(path.join(root, ".pre-commit-config.yml"))) {
    return { name: "pre-commit" };
  }
  return null;
}

export function isManaged(content) {
  return content.includes(MANAGED_MARKER);
}

// Merge our hook wiring into an existing hooks object (Codex hooks.json or the
// `hooks` key of a Claude settings.json). Replaces our own entries by command,
// preserves everything else, and never duplicates.
export function mergeHooks(existing, incoming) {
  const current = existing && typeof existing === "object" ? { ...existing } : {};
  current.hooks = current.hooks ? { ...current.hooks } : {};

  for (const [event, entries] of Object.entries(incoming.hooks || {})) {
    const incomingCommands = entries.flatMap((e) => (e.hooks || []).map((h) => h.command));
    const kept = (current.hooks[event] || []).filter((e) => {
      const cmds = (e.hooks || []).map((h) => h.command);
      return !cmds.some((c) => incomingCommands.includes(c));
    });
    current.hooks[event] = [...kept, ...entries];
  }
  return current;
}

// Markdown managed-block merge: replace the marked block if present, else append.
export function mergeManagedBlock(existing, rendered, label) {
  const start = `<!-- ${SKILL_NAME}:start ${label} -->`;
  const end = `<!-- ${SKILL_NAME}:end ${label} -->`;
  const block = `${start}\n${rendered.trim()}\n${end}`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (pattern.test(existing)) return existing.replace(pattern, block);
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${sep}${block}\n`;
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function git(root, args) {
  return run("git", ["-C", root, ...args], root);
}

// Inspect git readiness for a safe --apply. Mirrors the policy: never install
// from a protected/legacy branch, a dirty worktree, a repo missing stable/
// integration branches, or a non-short branch.
export function gitReadiness(root, config) {
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (isFailure(top)) return { isRepo: false, problems: [], warnings: ["Not a Git repository."] };

  const branchRaw = git(root, ["branch", "--show-current"]);
  const branch = isFailure(branchRaw) ? "" : branchRaw;
  const porcelain = git(root, ["status", "--porcelain"]);
  const namesRaw = git(root, ["branch", "--format=%(refname:short)"]);
  const names = isFailure(namesRaw) ? [] : String(namesRaw).split(/\r?\n/).filter(Boolean);
  const branches = new Set(names);
  const problems = [];
  const warnings = [];

  const { stableBranch: stable, integrationBranch: integration, legacyBranch: legacy } = config;
  const shortRe = new RegExp(`^(${config.shortBranchPrefixes.join("|")})/.+`);
  const p = (code, msg) => problems.push({ code, msg });

  if (porcelain && !isFailure(porcelain)) p("DIRTY", "worktree is not clean; commit, checkpoint, or stash first");
  if (!branches.has(stable)) p("MISSING_STABLE", `branch ${stable} is missing; make an initial commit / normalize the branch model first`);
  if (integration !== stable && !branches.has(integration)) p("MISSING_INTEGRATION", `branch ${integration} is missing; create the integration branch first`);

  if (branch === legacy) p("ON_LEGACY", `current branch is ${legacy}; normalize to ${stable}/${integration} before installing`);
  else if (branch === stable) p("ON_STABLE", `current branch is ${stable}; create a short branch from ${integration} first`);
  else if (branch === integration) p("ON_INTEGRATION", `current branch is ${integration}; create a dedicated short branch first`);
  else if (branch && !shortRe.test(branch)) p("NOT_SHORT", `current branch ${branch} is not a short work branch`);

  if (branches.has(legacy)) warnings.push(`branch ${legacy} exists; verify whether to rename to ${stable} or delete after migration`);

  return { isRepo: true, branch, branches, problems, warnings };
}

// Codes that a --bootstrap seed install may proceed through: seeding the engine
// onto the base branch is the whole point, so "on stable/integration" and
// "integration missing" are expected, not blockers. A dirty tree or a current
// legacy branch still blocks — you should not seed onto unstable ground.
export const BOOTSTRAP_ALLOWED = new Set(["ON_STABLE", "ON_INTEGRATION", "NOT_SHORT", "MISSING_INTEGRATION"]);
