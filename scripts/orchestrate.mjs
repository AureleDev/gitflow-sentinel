#!/usr/bin/env node
// managed-by: gitflow-sentinel (skill tooling)
// One-command ordered driver: doctor -> install (dry-run or apply) -> verify.
// Stops on a doctor problem. Never commits, pushes, opens PRs, merges, deletes
// branches, or normalizes legacy branches — those stay explicit agent steps so
// a human stays in the loop for anything irreversible.
import path from "node:path";
import { SKILL_ROOT, run, isFailure, nextValue, resolveProjectRoot } from "./lib.mjs";

function parseArgs(argv) {
  const args = { projectRoot: ".", apply: false, platform: "both", githubProtection: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--project-root") { args.projectRoot = nextValue(argv, i, a); i += 1; }
    else if (a === "--apply") args.apply = true;
    else if (a === "--dry-run") args.apply = false;
    else if (a === "--platform") { args.platform = nextValue(argv, i, a); i += 1; }
    else if (a === "--github-protection") args.githubProtection = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!["both", "codex", "claude"].includes(args.platform)) throw new Error("--platform must be both|codex|claude.");
  return args;
}

function step(title, command, argv, cwd, { fatal = true } = {}) {
  console.log(`\n=== ${title} ===`);
  const out = run(command, argv, cwd);
  console.log(isFailure(out) ? (out.stdout || out.message) : out);
  if (isFailure(out) && fatal) {
    console.error(`\nStopped at: ${title}`);
    process.exit(1);
  }
  return !isFailure(out);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("Usage: node orchestrate.mjs --project-root <path> [--apply] [--platform both|codex|claude]");
  process.exit(0);
}

const root = resolveProjectRoot(args.projectRoot);
const node = process.execPath;
const script = (n) => path.join(SKILL_ROOT, "scripts", n);

// Doctor is read-only and may legitimately report problems on a fresh repo
// (no main/dev yet); surface them but let install's own readiness gate decide.
step("Doctor (read-only audit)", node, [script("doctor.mjs"), "--project-root", root], root, { fatal: false });
step(args.apply ? "Install (apply)" : "Install (dry-run)", node,
  [script("install.mjs"), "--project-root", root, args.apply ? "--apply" : "--dry-run", "--platform", args.platform,
    ...(args.githubProtection ? ["--github-protection"] : [])], root);

if (args.apply) {
  // --skip-git-readiness: the step above already ran the git branch/sync
  // checks (CHECK 0-4, ~5-7 git spawns) moments ago; verify's own
  // installed-project doctor call still checks the newly-installed files and
  // wiring (the part that only makes sense to check after install), just
  // without repeating the git-state spawns for no new information.
  step("Verify", node, [script("verify.mjs"), "--project-root", root, "--skip-git-readiness"], root);
}

console.log("\n=== Next manual steps ===");
console.log("- Integrate AGENTS.md / CONTRIBUTING.md / CLAUDE.md if they pre-existed.");
console.log("- Commit on a short branch, push with upstream, open a PR to the integration branch.");
console.log("- Ask for the merge-or-keep-open decision; sync after an approved merge.");
