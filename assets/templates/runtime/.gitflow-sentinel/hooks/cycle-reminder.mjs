#!/usr/bin/env node
// managed-by: gitflow-sentinel
// Stop hook. A final advisory against leaving work in a half-finished Git state:
// uncommitted changes on a protected branch, or a "clean" short branch that was
// never pushed / has no PR / has a merged PR not yet synced locally. When that
// happens it prints a clear reminder but never traps the host in a stop loop.
import { loadConfig, isShortBranch, isProtected } from "../core/config.mjs";
import { readState, gh } from "../core/git.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("gitflow-sentinel Stop hook: final Git-state check at session end. Not meant to be run by hand.");
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
const integration = config.integrationBranch;
const branch = state.branch;
let incompleteClosure = false;

const changedCount = state.porcelain ? state.porcelain.split(/\r?\n/).filter(Boolean).length : 0;

if (changedCount > 0) {
  console.error(`gitflow-sentinel: ${changedCount} changed path(s) remain on ${branch}.`);
  if (isProtected(config, branch)) {
    console.error(`  - ${branch} must not carry direct edits. Move the work to a short branch or record an explicit override.`);
    incompleteClosure = true;
  } else {
    console.error("  - Run checks and create the appropriate commit before ending a validated step.");
    if (changedCount >= 8) console.error("  - The diff is large; consider a WIP checkpoint or a smaller commit boundary.");
  }
}

if (isShortBranch(config, branch)) {
  const clean = changedCount === 0;
  if (!state.remotes) {
    console.error("gitflow-sentinel: incomplete closure — no remote, so this branch cannot be reviewed on GitHub.");
    incompleteClosure = incompleteClosure || clean;
  } else if (!state.upstream) {
    console.error(`gitflow-sentinel: incomplete closure — ${branch} has no upstream. Push with git push -u origin ${branch}.`);
    incompleteClosure = incompleteClosure || clean;
  } else if (state.ahead) {
    console.error(`gitflow-sentinel: incomplete closure — ${branch} has local commits not pushed to ${state.upstream}.`);
    incompleteClosure = incompleteClosure || clean;
  } else {
    const prRaw = gh(["pr", "view", "--json", "number,state,baseRefName,url"], workdir);
    let pr = null;
    try { pr = prRaw ? JSON.parse(prRaw) : null; } catch { pr = null; }

    if (!pr) {
      console.error("gitflow-sentinel: incomplete closure — no PR could be verified. Open or update a PR toward " + integration + ".");
      console.error("  - If gh is not authenticated, run gh auth status and verify the PR manually.");
      incompleteClosure = incompleteClosure || clean;
    } else if (pr.state === "OPEN" && pr.baseRefName === integration) {
      console.error(`gitflow-sentinel: PR #${pr.number} targets ${integration}: ${pr.url}`);
      console.error(`  - Ask for the decision: merge to ${integration} now, or keep the branch open.`);
      console.error(`  - After an approved merge, switch to ${integration} and pull --ff-only before new work.`);
    } else if (pr.state === "MERGED") {
      console.error(`gitflow-sentinel: PR #${pr.number} is merged. Finish local sync before new work:`);
      console.error(`  - git fetch --prune && git switch ${integration} && git pull --ff-only`);
      incompleteClosure = true;
    } else {
      console.error(`gitflow-sentinel: incomplete closure — PR #${pr.number ?? "?"} is ${pr.state}/${pr.baseRefName}, expected OPEN/${integration}.`);
      incompleteClosure = incompleteClosure || clean;
    }
  }
}

if (incompleteClosure) {
  console.error("gitflow-sentinel: incomplete Git closure reported above; the stop hook is advisory and will not trap the session.");
}
process.exit(0);
