#!/usr/bin/env node
// managed-by: gitflow-sentinel
// PreToolUse guard. Wired into both .codex/hooks.json and .claude/settings.json.
// Blocking uses exit code 2 + stderr, a convention both runtimes honor: the
// tool call is denied and the message is fed back to the agent so it can self-
// correct. Advisory items print to stderr without blocking.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, policyDoc } from "../core/config.mjs";
import { readState, stagedDiff } from "../core/git.mjs";
import { analyze, isDirectEditTool, isShellFileWrite } from "../core/parser.mjs";
import { evaluate, partition } from "../core/policy.mjs";
import { parseInput, toolName, commands, filePaths, filePathsTouchRoot, cwd, readStdin } from "../core/event.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("gitflow-sentinel PreToolUse hook. Reads a tool-call event as JSON on stdin; not meant to be run by hand.");
  process.exit(0);
}

const raw = await readStdin();
const event = parseInput(raw);
const name = toolName(event);
const cmds = commands(event);
const targets = filePaths(event);
if (!name && !cmds.length) process.exit(0);

const workdir = cwd(event);
const segments = cmds.flatMap((c) => analyze(c));

// Skip the git state read (several `git` spawns) for tool calls that cannot
// possibly trigger a rule: no git/gh subcommand, no raw shell file-write
// pattern, and not a direct-edit tool. This is the overwhelming majority of
// tool calls in a session (reads, non-git shell commands, etc.), so it keeps
// the hook fast on every PreToolUse instead of only when it actually matters.
const directEdit = isDirectEditTool(name);
const commandRelevant = segments.some((s) => s.git || s.gh || isShellFileWrite(s));
const relevant = directEdit || commandRelevant;
if (!relevant) process.exit(0);

const state = readState(workdir);
const directEditInWorktree = directEdit
  ? filePathsTouchRoot(targets, workdir, state.root)
  : false;
// A known direct-edit tool aimed wholly outside this repository is outside the
// repository policy. Unknown/missing targets still fail closed on protected
// branches, while any nested shell/git command remains independently checked.
if (directEdit && directEditInWorktree === false && !commandRelevant) process.exit(0);

const config = loadConfig(path.resolve(workdir));
// Loudly surface a broken config instead of silently applying defaults — a typo
// in protectedBranches must not quietly disable protection (mirrors the native
// git layer's own check in githooks/native.mjs).
if (config._valid === false) {
  console.error("gitflow-sentinel BLOCK [CONFIG_INVALID]: .gitflow-sentinel.json is invalid.");
  for (const error of config._errors || []) console.error(`  - ${error.field}: ${error.message}`);
  process.exit(2);
}

// Only honor the override marker when it appears in the COMMAND text (e.g. a
// trailing `# GITFLOW_OVERRIDE=explicit: reason`). Matching the whole payload
// would let any file/diff content that merely contains the marker string switch
// the guard off — self-poisoning. The command is the deliberate, auditable spot.
const overrideRe = new RegExp(config.overrideMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const hasOverride = cmds.some((c) => overrideRe.test(c));

const needsDiff = segments.some((s) => s.git?.subcommand === "commit");

const decisions = evaluate({
  config,
  state,
  toolName: name,
  directEditInWorktree: directEditInWorktree !== false,
  segments,
  hasOverride,
  stagedDiff: needsDiff ? stagedDiff(workdir) : "",
});

const { blocks, warns } = partition(decisions);

for (const w of warns) {
  console.error(`gitflow-sentinel: ${w.message}`);
  for (const d of w.details) console.error(`  - ${d}`);
}

if (blocks.length) {
  for (const b of blocks) {
    console.error(`gitflow-sentinel BLOCK [${b.code}]: ${b.message}`);
    for (const d of b.details) console.error(`  - ${d}`);
  }
  console.error(`Reference: ${policyDoc(config)}`);
  process.exit(2);
}

process.exit(0);
