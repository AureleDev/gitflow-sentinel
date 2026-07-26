#!/usr/bin/env node
// managed-by: gitflow-sentinel (skill tooling)
// Verification suite: syntax-checks every script, runs policy-engine scenario
// assertions (the behavioral contract), and — when pointed at an installed repo
// — runs the doctor. Exits non-zero on any failure. This is the regression net
// for the engine, so behavior cannot silently drift.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { SKILL_ROOT, TEMPLATE_ROOT, listFiles, run, isFailure, nextValue, resolveProjectRoot } from "./lib.mjs";
import { DEFAULTS } from "../assets/templates/runtime/.gitflow-sentinel/core/config.mjs";
import { analyze } from "../assets/templates/runtime/.gitflow-sentinel/core/parser.mjs";
import { evaluate, partition } from "../assets/templates/runtime/.gitflow-sentinel/core/policy.mjs";
import { parseInput, toolName, commands, cwd as eventCwd } from "../assets/templates/runtime/.gitflow-sentinel/core/event.mjs";

const execFileAsync = promisify(execFile);

function usage() {
  return "Usage: node verify.mjs [--project-root <path>] [--skip-git-readiness]";
}

function parseArgs(argv) {
  const args = { projectRoot: "", skipGitReadiness: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--project-root") { args.projectRoot = nextValue(argv, i, a); i += 1; }
    else if (a === "--skip-git-readiness") args.skipGitReadiness = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const cliArgs = parseArgs(process.argv.slice(2));
if (cliArgs.help) {
  console.log(usage());
  process.exit(0);
}

let passed = 0;
let failed = 0;
function ok(label) { passed += 1; console.log(`  PASS ${label}`); }
function bad(label, detail) { failed += 1; console.log(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`); }

const config = { ...DEFAULTS };
const base = { isRepo: true, branch: "dev", dirty: false, remotes: "origin", upstream: "origin/dev", branches: new Set(["main", "dev"]), stagedFiles: [], porcelain: "" };

function codes(ctx) {
  const { blocks, warns } = partition(evaluate(ctx));
  return { blocks: blocks.map((b) => b.code), warns: warns.map((w) => w.code) };
}

function expectBlock(label, ctx, code) {
  const { blocks } = codes(ctx);
  blocks.includes(code) ? ok(label) : bad(label, `expected block ${code}, got [${blocks.join(", ")}]`);
}
function expectNoBlock(label, ctx) {
  const { blocks } = codes(ctx);
  blocks.length === 0 ? ok(label) : bad(label, `expected no block, got [${blocks.join(", ")}]`);
}
function expectWarn(label, ctx, code) {
  const { warns } = codes(ctx);
  warns.includes(code) ? ok(label) : bad(label, `expected warn ${code}, got [${warns.join(", ")}]`);
}

function st(over) { return { ...base, ...over }; }
function seg(cmd) { return analyze(cmd); }

console.log("1) Syntax checks");
const scripts = [
  ...listFiles(path.join(TEMPLATE_ROOT, "runtime")).filter((f) => f.endsWith(".mjs")),
  ...listFiles(path.join(SKILL_ROOT, "scripts")).filter((f) => f.endsWith(".mjs")),
];
// Each file's syntax check is independent, so run them concurrently instead of
// spawning ~20 Node processes back to back — the dominant cost on Windows is
// per-process spawn overhead (CreateProcess, antivirus), not CPU work.
const syntaxResults = await Promise.all(scripts.map(async (f) => {
  try {
    await execFileAsync(process.execPath, ["--check", f], { stdio: ["ignore", "pipe", "pipe"] });
    return { f, ok: true };
  } catch (e) {
    return { f, ok: false, detail: String(e.stderr || e.message).split("\n")[0] };
  }
}));
for (const r of syntaxResults) {
  r.ok ? ok(path.relative(SKILL_ROOT, r.f)) : bad(path.relative(SKILL_ROOT, r.f), r.detail);
}

console.log("\n2) Policy scenarios");
expectBlock("commit on dev blocked", { config, state: st({ branch: "dev" }), segments: seg("git commit -m 'feat: x'") }, "MUTATION_PROTECTED");
expectBlock("commit on main blocked", { config, state: st({ branch: "main", upstream: "origin/main" }), segments: seg("git commit -m 'feat: x'") }, "MUTATION_PROTECTED");
expectBlock("chained push to main blocked", { config, state: st({ branch: "feat/x", upstream: "origin/feat/x" }), segments: seg("npm run lint && git push origin main") }, "PUSH_PROTECTED");
expectBlock("short branch from main blocked", { config, state: st({ branch: "main" }), segments: seg("git switch -c feat/login") }, "SHORT_BRANCH_BASE");
expectBlock("branch create dirty blocked", { config, state: st({ branch: "dev", dirty: true }), segments: seg("git switch -c feat/x") }, "CREATE_DIRTY");
expectBlock("switch dirty blocked", { config, state: st({ branch: "feat/a", dirty: true }), segments: seg("git switch dev") }, "SWITCH_DIRTY");
expectBlock("PR feat->main blocked", { config, state: st({ branch: "feat/x" }), segments: seg("gh pr create --base main --head feat/x --title t") }, "PR_ROUTE");
expectBlock("PR no base blocked", { config, state: st({ branch: "feat/x" }), segments: seg("gh pr create --title t --body b") }, "PR_NO_BASE");
expectBlock("pr merge blocked", { config, state: st({ branch: "feat/x" }), segments: seg("gh pr merge 12 --merge") }, "PR_MERGE");
expectBlock("api merge blocked", { config, state: st({ branch: "feat/x" }), segments: seg("gh api repos/o/r/pulls/3/merge -X PUT") }, "PR_MERGE");
expectBlock("secret staged blocked", { config, state: st({ branch: "feat/x", stagedFiles: [".env"] }), segments: seg("git commit -m 'feat: x'") }, "SECRET_STAGED");
expectNoBlock("PR feat->dev allowed", { config, state: st({ branch: "feat/x" }), segments: seg("gh pr create --base dev --title t --body b") });
expectNoBlock("commit on feat allowed", { config, state: st({ branch: "feat/x" }), segments: seg("git commit -m 'feat: x'") });
expectNoBlock("override bypasses block", { config, state: st({ branch: "dev" }), segments: seg("git commit -m x # GITFLOW_OVERRIDE=explicit: r"), hasOverride: true });
expectWarn("non-conventional message warns", { config, state: st({ branch: "feat/x" }), segments: seg("git commit -m 'stuff'") }, "COMMIT_FORMAT");
expectWarn("worktree warns", { config, state: st({ branch: "feat/x" }), segments: seg("git worktree add ../wt feat/x") }, "WORKTREE");

console.log("\n2b) Event payload parsing (Codex vs Claude Code)");
// Exercises core/event.mjs directly instead of only analyze()/evaluate() — the
// gap this closes: a regression in parseInput/toolName/commands/cwd (the layer
// that normalizes Codex's and Claude Code's different payload shapes into one
// command list) would previously not fail any test here, even though it is the
// documented parity guarantee between the two platforms.
function payloadCase(label, payload, expect) {
  const event = parseInput(JSON.stringify(payload));
  const name = toolName(event);
  const cmds = commands(event);
  const wd = eventCwd(event);
  const okName = expect.tool === undefined || name === expect.tool;
  const okCmd = expect.cmd === undefined || cmds.includes(expect.cmd);
  const okCwd = expect.cwd === undefined || wd === expect.cwd;
  (okName && okCmd && okCwd) ? ok(label) : bad(label, `tool=${name} cmds=${JSON.stringify(cmds)} cwd=${wd}`);
}

payloadCase("Claude Code Bash tool_input.command shape", {
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "git push origin main" },
}, { tool: "Bash", cmd: "git push origin main" });

payloadCase("Codex functions.shell_command flat parameters shape", {
  recipient_name: "functions.shell_command",
  parameters: { command: "git push origin main", workdir: "/tmp/proj" },
}, { tool: "functions.shell_command", cmd: "git push origin main", cwd: "/tmp/proj" });

payloadCase("Codex nested tool_uses batch shape", {
  tool_uses: [
    { recipient_name: "functions.shell_command", parameters: { command: "npm test" } },
    { recipient_name: "functions.shell_command", parameters: { command: "git push origin dev", workdir: "/tmp/proj2" } },
  ],
}, { cmd: "git push origin dev", cwd: "/tmp/proj2" });

payloadCase("Codex apply_patch tool name recognized", {
  recipient_name: "functions.apply_patch",
}, { tool: "functions.apply_patch" });

console.log("\n3) Hardened-rule scenarios");
const feat = (over) => st({ branch: "feat/x", upstream: "origin/feat/x", ...over });
expectBlock("path-to-binary push to main blocked", { config, state: feat(), segments: seg("/usr/bin/git push origin main") }, "PUSH_PROTECTED");
expectBlock("sh -c nested push to main blocked", { config, state: feat(), segments: seg("sh -c 'git push origin main'") }, "PUSH_PROTECTED");
expectBlock("--no-verify blocked even with override", { config, state: feat(), segments: seg("git commit --no-verify -m x"), hasOverride: true }, "NO_VERIFY");
expectBlock("core.hooksPath tamper blocked", { config, state: feat(), segments: seg("git config core.hooksPath /dev/null") }, "HOOKSPATH_TAMPER");
expectBlock("force-push to main blocked", { config, state: feat(), segments: seg("git push --force origin main") }, "FORCE_PUSH_PROTECTED");
expectBlock("remote delete of main blocked", { config, state: feat(), segments: seg("git push origin --delete main") }, "PROTECTED_DELETE");
expectBlock("gh api ref delete blocked", { config, state: feat(), segments: seg("gh api repos/o/r/git/refs/heads/main -X DELETE") }, "GH_API_WRITE");
expectBlock("secret stays blocked under override", { config, state: feat({ stagedFiles: [".env"] }), segments: seg("git commit -m 'feat: x'"), hasOverride: true }, "SECRET_STAGED");
expectWarn("tag push warns", { config, state: feat(), segments: seg("git push --tags") }, "TAG_OP");
expectWarn("detached HEAD commit warns", { config, state: st({ branch: "(detached)" }), segments: seg("git commit -m 'feat: x'") }, "DETACHED_HEAD");
expectWarn("force-push shared branch warns", { config, state: feat(), segments: seg("git push --force-with-lease origin feat/x") }, "FORCE_PUSH_SHARED");

if (cliArgs.projectRoot) {
  const root = resolveProjectRoot(cliArgs.projectRoot);
  console.log("\n4) Installed-project doctor");
  const doctorArgs = [path.join(SKILL_ROOT, "scripts", "doctor.mjs"), "--project-root", root];
  if (cliArgs.skipGitReadiness) doctorArgs.push("--skip-git-readiness");
  const out = run(process.execPath, doctorArgs, root);
  isFailure(out) ? bad("doctor", "doctor reported blocking problems") : ok("doctor passed");
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
