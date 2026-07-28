#!/usr/bin/env node
// managed-by: gitflow-sentinel (skill tooling)
// Unified entry point: `gitflow-sentinel <command> [options]`. Without this,
// every command required knowing the absolute path to this skill's scripts/
// directory (e.g. `node C:\Users\<name>\.codex\skills\gitflow-sentinel\scripts\
// doctor.mjs ...`) — exactly the kind of path that breaks the moment the skill
// moves, the machine changes, or a teammate installs it somewhere else. Once
// this package is installed (`npm link`, a global install, or `npx
// gitflow-sentinel@github:AureleDev/gitflow-sentinel`), the subcommands below
// are reachable from any directory without that path.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const COMMANDS = {
  inspect: "inspect.mjs",
  init: "init-project.mjs",
  plan: "plan.mjs",
  apply: "apply.mjs",
  status: "status.mjs",
  rollback: "rollback.mjs",
  resume: "resume.mjs",
  update: "update.mjs",
  doctor: "core-doctor.mjs",
  "legacy-doctor": "doctor.mjs",
  install: "install.mjs",
  verify: "foundation-verify.mjs",
  check: "quality-check.mjs",
  "self-test": "verify.mjs",
  uninstall: "core-uninstall.mjs",
  "legacy-uninstall": "uninstall.mjs",
  orchestrate: "orchestrate.mjs",
  "github-protect": "github-protect.mjs",
};

function usage() {
  console.log(`Usage: gitflow-sentinel <command> [options]

Commands:
  inspect          Build a read-only, redacted project snapshot.
  init             Plan greenfield or existing-project foundations.
  plan             Produce an immutable, risk-classified change plan.
  apply            Apply one approved plan transactionally.
  status           Show drift and transaction history.
  rollback         Restore a completed local transaction.
  resume           Resume an interrupted transaction.
  update           Plan changes against the current desired state.
  verify           Verify local foundations and GitHub policy.
  check            Preview and run one approved quality command, recording state-bound evidence.
  self-test        Run Sentinel's internal behavioral test suite.
  doctor           Diagnose Sentinel Core dependencies and compatibility.
  legacy-doctor    Audit a historical 2.x guardrail installation.
  install          Legacy 2.x guardrail installer.
  uninstall        Restore all owned local changes from Sentinel transactions.
  legacy-uninstall Remove a historical 2.x guardrail installation.
  orchestrate      Legacy 2.x doctor -> install -> self-test workflow.
  github-protect   Legacy direct ruleset command; prefer an approved R3 plan.

Run 'gitflow-sentinel <command> --help' for command-specific options.`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "--help" || cmd === "-h") {
  usage();
  process.exit(cmd ? 0 : 1);
}

const file = COMMANDS[cmd];
if (!file) {
  console.error(`Unknown command: ${cmd}\n`);
  usage();
  process.exit(1);
}

const LEGACY_COMMANDS = new Set(["install", "orchestrate", "github-protect", "legacy-doctor", "legacy-uninstall"]);
if (LEGACY_COMMANDS.has(cmd)) {
  console.warn(`NOTICE: '${cmd}' is a compatibility command. Prefer inspect -> plan -> apply -> verify for new work.`);
}

const result = spawnSync(process.execPath, [path.join(HERE, file), ...rest], { stdio: "inherit" });
process.exit(result.status ?? 1);
