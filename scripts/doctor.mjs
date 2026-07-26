#!/usr/bin/env node
// managed-by: gitflow-sentinel (skill tooling)
// Read-only audit of Git state + installed guardrails. Prints an ordered
// checklist and findings, and exits 1 on any blocking problem so callers can
// stop before mutating a repo. Mutates nothing.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SKILL_ROOT, RUNTIME_VERSION, git, isFailure, gitReadiness, detectHookManager, nextValue, resolveProjectRoot } from "./lib.mjs";
import { loadConfig, isShortBranch } from "../assets/templates/runtime/.gitflow-sentinel/core/config.mjs";

function parseArgs(argv) {
  const args = { projectRoot: ".", json: false, skipGitReadiness: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--project-root") { args.projectRoot = nextValue(argv, i, a); i += 1; }
    else if (a === "--json") args.json = true;
    // Internal: skips the git branch/sync spawns (CHECK 0-4) and assumes a repo
    // is already confirmed present. Used by verify.mjs's post-install re-check
    // so it does not repeat the same ~5-7 git spawns doctor already ran moments
    // earlier in the same orchestrate run; the file/wiring checks below still run.
    else if (a === "--skip-git-readiness") args.skipGitReadiness = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

// Fingerprints of the earlier "gitflow-sentinel"/"git-project-guardrails"
// generation this project may have grown organically from (per-project
// copy-paste rather than this shared skill). Installing on top without
// clearing these out leaves two hook generations wired at once — both firing
// on every PreToolUse, with no shared config and possibly contradictory
// decisions. This check exists so that coexistence is loud, not invisible.
const LEGACY_MARKERS = [
  { rel: ".codex/hooks/git-command-guard.mjs", label: "legacy Codex hook: .codex/hooks/git-command-guard.mjs" },
  { rel: ".codex/hooks/git-session-start.mjs", label: "legacy Codex hook: .codex/hooks/git-session-start.mjs" },
  { rel: ".codex/hooks/git-cycle-reminder.mjs", label: "legacy Codex hook: .codex/hooks/git-cycle-reminder.mjs" },
  { rel: ".codex/git-project-guardrails.manifest.json", label: "legacy manifest: .codex/git-project-guardrails.manifest.json" },
  { rel: ".gitflow-sentinel.json", label: null }, // checked separately below (managed-by marker), not a plain presence flag
];

function detectLegacyGeneration(root, readIf) {
  const found = [];
  for (const m of LEGACY_MARKERS) {
    if (m.label && existsSync(path.join(root, m.rel))) found.push(m.label);
  }
  const rulesFile = readIf(path.join(root, ".codex/rules/git-safety.rules"));
  if (rulesFile && /managed-by:\s*(git-project-guardrails|gitflow-sentinel)\b/.test(rulesFile)) {
    const m = rulesFile.match(/managed-by:\s*([\w-]+)/);
    if (m && m[1] !== "gitflow-sentinel") found.push(`.codex/rules/git-safety.rules is managed by '${m[1]}', not gitflow-sentinel`);
  }
  const hooksJson = readIf(path.join(root, ".codex/hooks.json"));
  if (hooksJson && /\.codex\/hooks\/git-(command-guard|session-start|cycle-reminder)\.mjs/.test(hooksJson)) {
    found.push(".codex/hooks.json still wires the legacy per-project hook scripts alongside (or instead of) gitflow-sentinel's");
  }
  return found;
}

function readIf(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log("Usage: node doctor.mjs --project-root <path> [--json]"); return; }

  const root = resolveProjectRoot(args.projectRoot);
  const config = loadConfig(root);
  const findings = [];
  const checks = [];
  const problem = (code, msg, detail = "") => findings.push({ severity: "problem", code, msg, detail });
  const warn = (code, msg, detail = "") => findings.push({ severity: "warning", code, msg, detail });

  // --- Git state ---
  if (args.skipGitReadiness) checks.push({ id: "CHECK 0-4", label: "git branch/sync state", status: "SKIPPED", detail: "already checked earlier in this run" });
  const readiness = args.skipGitReadiness ? { isRepo: true } : gitReadiness(root, config);
  if (args.skipGitReadiness) {
    // fall through to file/wiring checks below
  } else if (!readiness.isRepo) {
    checks.push({ id: "CHECK 0", label: "git state read", status: "FAIL", detail: "not a git repo" });
    problem("GIT_NOT_REPO", "Project is not a Git repository.");
  } else {
    const { branch, branches } = readiness;
    checks.push({ id: "CHECK 0", label: "git state read", status: "PASS", detail: branch });
    const has = (b) => branches.has(b);
    checks.push({ id: "CHECK 1", label: `${config.legacyBranch} absent/normalized`, status: has(config.legacyBranch) || branch === config.legacyBranch ? "FAIL" : "PASS" });
    if (has(config.legacyBranch)) problem("LEGACY_PRESENT", `${config.legacyBranch} is present; normalize to ${config.stableBranch}/${config.integrationBranch}.`);
    checks.push({ id: "CHECK 2", label: `${config.stableBranch} + ${config.integrationBranch} present`, status: has(config.stableBranch) && has(config.integrationBranch) ? "PASS" : "FAIL" });
    if (!has(config.stableBranch) || !has(config.integrationBranch)) problem("MISSING_BRANCHES", `${config.stableBranch} and ${config.integrationBranch} must both exist.`);

    const devSync = git(root, ["rev-list", "--left-right", "--count", `${config.integrationBranch}...origin/${config.integrationBranch}`]);
    if (has(config.integrationBranch) && !isFailure(devSync)) {
      const [ahead, behind] = String(devSync).split(/\s+/).map(Number);
      checks.push({ id: "CHECK 3", label: `${config.integrationBranch} clean & synced`, status: ahead === 0 && behind === 0 ? "PASS" : "FAIL", detail: `ahead=${ahead} behind=${behind}` });
      if (ahead || behind) problem("INTEGRATION_NOT_SYNCED", `${config.integrationBranch} is not aligned with origin.`);
    } else {
      checks.push({ id: "CHECK 3", label: `${config.integrationBranch} clean & synced`, status: "PASS", detail: "local-only or no origin" });
    }
    checks.push({ id: "CHECK 4", label: "on a short branch from integration", status: isShortBranch(config, branch) ? "PASS" : "PENDING", detail: branch });
  }

  // --- Installed files ---
  const required = [
    ".gitflow-sentinel/core/policy.mjs",
    ".gitflow-sentinel/core/parser.mjs",
    ".gitflow-sentinel/core/config.mjs",
    ".gitflow-sentinel/core/secrets.mjs",
    ".gitflow-sentinel/core/external.mjs",
    ".gitflow-sentinel/activate.mjs",
    ".gitflow-sentinel/hooks/guard.mjs",
    ".gitflow-sentinel/hooks/session-start.mjs",
    ".gitflow-sentinel/hooks/cycle-reminder.mjs",
    ".gitflow-sentinel.json",
  ];
  // Distinguish "never installed" (one clean signal) from a partial/broken
  // install (per-file), so an audit of an un-onboarded repo does not read as a
  // pile of separate defects mixed in with genuine branch-hygiene problems.
  const missingFiles = required.filter((f) => !existsSync(path.join(root, f)));
  if (!existsSync(path.join(root, ".gitflow-sentinel"))) {
    problem("NOT_INSTALLED", "gitflow-sentinel is not installed here yet — run install. (The branch-hygiene findings below are independent of this.)");
  } else {
    for (const f of missingFiles) problem("MISSING_FILE", `Missing required file: ${f}`);
  }

  const hasCodex = existsSync(path.join(root, ".codex/hooks.json"));
  const hasClaude = existsSync(path.join(root, ".claude/settings.json"));
  if (!hasCodex && !hasClaude) problem("NO_WIRING", "Neither .codex/hooks.json nor .claude/settings.json wires the hooks.");
  if (hasCodex && !readIf(path.join(root, ".codex/hooks.json")).includes("guard.mjs")) problem("CODEX_WIRING", ".codex/hooks.json does not wire guard.mjs.");
  if (hasClaude && !readIf(path.join(root, ".claude/settings.json")).includes("guard.mjs")) problem("CLAUDE_WIRING", ".claude/settings.json does not wire guard.mjs.");

  for (const f of ["AGENTS.md", "CONTRIBUTING.md"]) {
    if (!existsSync(path.join(root, f))) warn("ADVISORY_MISSING", `Project-facing doc absent: ${f}`);
  }

  // Codex's PreToolUse/SessionStart/Stop hooks are an experimental, opt-in
  // feature (requires [features] codex_hooks = true in ~/.codex/config.toml)
  // and, as of this writing, are not available on Windows at all. Wiring
  // .codex/hooks.json is harmless either way, but a repo relying on it as the
  // *only* enforcement layer on Windows (or with hooks not enabled) would
  // silently have no agent-side guard — only the native git layer would hold.
  if (hasCodex && process.platform === "win32") {
    warn("CODEX_HOOKS_WINDOWS", "Codex CLI hooks are experimental and not available on Windows; the agent layer for Codex may not fire here.", "the native git layer (pre-commit/pre-push) still enforces regardless — see references/platform-adapters.md");
  }

  // Coexistence with an earlier, per-project generation of this same idea
  // ("gitflow-sentinel" v1.x or its "git-project-guardrails" fork/rename),
  // typically copy-pasted project by project before this shared skill existed.
  // Installing on top without clearing it out leaves two hook generations
  // wired at once. See references/migration.md for the cleanup steps.
  const legacyFound = detectLegacyGeneration(root, readIf);
  for (const l of legacyFound) {
    problem("LEGACY_GENERATION", `Earlier gitflow-sentinel/git-project-guardrails generation detected: ${l}`, "see references/migration.md before installing, or the two hook generations will run in parallel");
  }

  // Native git hooks layer: present on disk, and activated via core.hooksPath or
  // injected into an existing hook manager (husky)?
  const nativeDir = path.join(root, ".gitflow-sentinel/githooks");
  const nativePresent = ["pre-commit", "commit-msg", "pre-push", "native.mjs"].every((f) => existsSync(path.join(nativeDir, f)));
  const injectedInHusky = ["pre-commit", "commit-msg", "pre-push"]
    .some((h) => readIf(path.join(root, ".husky", h)).includes(".gitflow-sentinel/githooks/native.mjs"));
  if (readiness.isRepo) {
    const hp = git(root, ["config", "--local", "core.hooksPath"]);
    const hooksPath = isFailure(hp) ? "" : String(hp).trim();
    if (nativePresent && hooksPath === ".gitflow-sentinel/githooks") {
      checks.push({ id: "CHECK 6", label: "native git hooks active", status: "PASS", detail: "core.hooksPath set" });
    } else if (nativePresent && injectedInHusky) {
      checks.push({ id: "CHECK 6", label: "native git hooks active", status: "PASS", detail: "injected into husky" });
    } else if (nativePresent && hooksPath) {
      checks.push({ id: "CHECK 6", label: "native git hooks active", status: "WARN", detail: `core.hooksPath=${hooksPath}` });
      warn("HOOKSPATH_OTHER", `core.hooksPath points to '${hooksPath}', not gitflow-sentinel and no husky injection found; native enforcement may be inactive.`);
    } else if (nativePresent) {
      checks.push({ id: "CHECK 6", label: "native git hooks active", status: "WARN", detail: "not armed" });
      warn("HOOKSPATH_UNSET", "Native hooks are installed but not armed. Run: node .gitflow-sentinel/activate.mjs (or `npm install` if a prepare step is wired).");
    } else {
      checks.push({ id: "CHECK 6", label: "native git hooks active", status: "PENDING", detail: "native layer not installed (--no-git-hooks)" });
    }
  }

  // Node is required at hook runtime; flag an unusable/old runtime early.
  const nodeMajor = Number((process.versions?.node || "0").split(".")[0]);
  if (nodeMajor && nodeMajor < 18) warn("NODE_OLD", `Node ${process.versions.node} detected; the runtime targets Node >= 18.`);
  const manager = detectHookManager(root);
  if (manager) checks.push({ id: "CHECK 7", label: "hook manager coexistence", status: "PASS", detail: manager.name });

  const ver = readIf(path.join(root, ".gitflow-sentinel/VERSION")).trim();
  if (ver && ver !== RUNTIME_VERSION) warn("VERSION_DRIFT", `Installed runtime ${ver} differs from skill ${RUNTIME_VERSION}.`);

  const blocking = findings.filter((f) => f.severity === "problem");
  checks.push({ id: "CHECK 5", label: "guardrail files installed", status: blocking.length ? "FAIL" : "PASS" });

  if (args.json) {
    console.log(JSON.stringify({ root, checks, findings }, null, 2));
  } else {
    console.log("gitflow-sentinel doctor");
    console.log(`Project root: ${root}`);
    console.log(`Config: ${config._source}`);
    console.log("\nChecklist:");
    for (const c of checks) console.log(`- ${c.status} ${c.id}: ${c.label}${c.detail ? ` - ${c.detail}` : ""}`);
    console.log("\nFindings:");
    if (!findings.length) console.log("- PASS no findings");
    for (const f of findings) console.log(`- ${f.severity === "problem" ? "PROBLEM" : "WARNING"} ${f.code}: ${f.msg}${f.detail ? ` (${f.detail})` : ""}`);
  }

  if (blocking.length) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
