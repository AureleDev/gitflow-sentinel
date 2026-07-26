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
  doctor: "doctor.mjs",
  install: "install.mjs",
  verify: "verify.mjs",
  uninstall: "uninstall.mjs",
  orchestrate: "orchestrate.mjs",
  "github-protect": "github-protect.mjs",
};

function usage() {
  console.log(`Usage: gitflow-sentinel <command> [options]

Commands:
  doctor           Read-only audit of Git state + installed guardrails.
  install          Install the guardrails into a project.
  verify           Run the behavioral test suite (+ installed-project doctor).
  uninstall        Cleanly remove the guardrails.
  orchestrate      Run doctor -> install -> verify in order (recommended default).
  github-protect   Configure server-side GitHub branch protection.

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

const result = spawnSync(process.execPath, [path.join(HERE, file), ...rest], { stdio: "inherit" });
process.exit(result.status ?? 1);
