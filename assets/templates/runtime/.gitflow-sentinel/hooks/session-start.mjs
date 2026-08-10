#!/usr/bin/env node
// managed-by: gitflow-sentinel
// SessionStart hook. Purely informational: it orients the agent at the start of
// a session so the very first action already respects the branch model. Never
// blocks. Reads the project config so the guidance matches the team's policy.
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, isProtected, isShortBranch } from "../core/config.mjs";
import { readState } from "../core/git.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function currentCliVersion() {
  const options = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 };
  try {
    return execFileSync("gitflow-sentinel", ["--version"], options).trim();
  } catch {
    if (process.platform !== "win32") return "";
    try {
      return execFileSync(process.env.ComSpec || "cmd.exe", [
        "/d", "/s", "/c", "gitflow-sentinel.cmd --version",
      ], options).trim();
    } catch {
      return "";
    }
  }
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("gitflow-sentinel SessionStart hook: orients the agent at session start. Not meant to be run by hand.");
  process.exit(0);
}

const workdir = process.cwd();
const state = readState(workdir);
if (!state.isRepo) process.exit(0);

const config = loadConfig(workdir);
// Loudly surface a broken config instead of silently applying defaults — a typo
// in protectedBranches must not quietly disable protection.
if (typeof config._source === "string" && config._source.startsWith("defaults (invalid")) {
  console.error(`gitflow-sentinel: WARNING — ${config._source}. Using built-in defaults.`);
}
const { branch, integrationBranch: integration, stableBranch: stable, legacyBranch: legacy } = {
  branch: state.branch,
  ...config,
};

let installedVersion = "";
try { installedVersion = readFileSync(path.join(HERE, "..", "VERSION"), "utf8").trim(); } catch { /* advisory only */ }
const cliVersion = currentCliVersion();
if (installedVersion && cliVersion && installedVersion !== cliVersion) {
  console.error(`gitflow-sentinel: runtime ${installedVersion} differs from installed CLI ${cliVersion}; run gitflow-sentinel update.`);
}

console.error(`gitflow-sentinel: branch ${state.branch}; worktree ${state.dirty ? "dirty" : "clean"}.`);

if (state.branch === legacy) {
  console.error(`  - ${legacy} is a legacy stable branch. Normalize to ${stable}/${integration} before working.`);
} else if (state.branch === stable) {
  console.error(`  - ${stable} is stable. Switch to ${integration}, pull --ff-only, then create a short branch.`);
} else if (state.branch === integration) {
  console.error(`  - ${integration} is for integration. Create a short branch for the actual work.`);
} else if (isShortBranch(config, state.branch)) {
  console.error(`  - Short branch detected. It should target ${integration}, not ${stable}.`);
}

if (!state.remotes) {
  console.error("  - No remote configured; this repository is local-only until origin is set.");
} else if (!state.upstream) {
  console.error("  - Current branch has no upstream; push with -u when syncing the first time.");
}

if (state.dirty && isProtected(config, state.branch)) {
  console.error(`  - Uncommitted changes on a protected branch; move them to a short branch.`);
}

process.exit(0);
