#!/usr/bin/env node
import { parseProjectArgs, createPlanFor } from "./core/command-helpers.mjs";
import { rulesetMatches } from "./core/providers/github.mjs";
import { modulesFor } from "./core/config.mjs";
import { compactPendingActions } from "./core/public-output.mjs";

function verifyRuleset(snapshot, config) {
  if (!snapshot.provider.github.checked) return { status: "pending", detail: "GitHub was not queried; rerun with --remote." };
  if (!snapshot.provider.github.connected) return { status: "pending", detail: "GitHub remote is not connected." };
  const ruleset = snapshot.provider.github.ruleset;
  if (!ruleset.readable) return { status: "error", detail: "GitHub ruleset state could not be read." };
  const remoteBranches = new Set(snapshot.provider.github.remoteBranches);
  const missing = config.vcs.protectedBranches.filter((branch) => !remoteBranches.has(branch));
  if (missing.length) return { status: "fail", detail: `Required remote branch(es) are missing: ${missing.join(", ")}.` };
  return rulesetMatches(ruleset, config.vcs.protectedBranches, config.github.reviewers)
    ? { status: "pass", detail: `ruleset ${ruleset.id}` }
    : { status: "fail", detail: "GitHub ruleset differs in branches, enforcement, rules, or reviewer count." };
}

function verifyRemoteBranches(snapshot, config) {
  if (!snapshot.provider.github.checked) return { status: "pending", detail: "GitHub was not queried; rerun with --remote." };
  if (!snapshot.provider.github.connected) return { status: "pending", detail: "GitHub remote is not connected." };
  const available = new Set(snapshot.provider.github.remoteBranches);
  const missing = config.vcs.protectedBranches.filter((branch) => !available.has(branch));
  return missing.length
    ? { status: "fail", detail: `Required remote branch(es) are missing: ${missing.join(", ")}.` }
    : { status: "pass", detail: `Required remote branches exist: ${config.vcs.protectedBranches.join(", ")}.` };
}

function verifyDefaultBranch(snapshot, config) {
  if (!snapshot.provider.github.checked) return { status: "pending", detail: "GitHub was not queried; rerun with --remote." };
  if (!snapshot.provider.github.connected) return { status: "pending", detail: "GitHub remote is not connected." };
  const expected = config.vcs.integrationBranch;
  return snapshot.provider.github.defaultBranch === expected
    ? { status: "pass", detail: expected }
    : { status: "fail", detail: `GitHub default branch is ${snapshot.provider.github.defaultBranch || "unknown"}; expected ${expected}.` };
}

try {
  const args = parseProjectArgs(process.argv.slice(2), { output: false });
  if (args.help) {
    console.log("Usage: gitflow-sentinel verify [path] [--remote|--offline] [--json [--compact]]");
  } else {
    const { snapshot, loaded, plan } = createPlanFor(args.projectRoot, args.profile, args.modules, args);
    const localActions = plan.actions.filter((action) => !action.type.startsWith("github-"));
    const checks = [
      { id: "config", status: loaded.source === "file" ? "pass" : "fail", detail: loaded.source },
      { id: "local-foundations", status: localActions.length ? "fail" : "pass", detail: `${localActions.length} pending action(s)` },
    ];
    if (modulesFor(loaded.config).includes("github") && loaded.config.github.manageRuleset) {
      checks.push({ id: "github-branches", ...verifyRemoteBranches(snapshot, loaded.config) });
      if (loaded.config.vcs.strategy === "git-flow") {
        checks.push({ id: "github-default-branch", ...verifyDefaultBranch(snapshot, loaded.config) });
      }
      checks.push({ id: "github-ruleset", ...verifyRuleset(snapshot, loaded.config) });
    }
    const failed = checks.some((check) => ["fail", "error"].includes(check.status));
    const pending = checks.some((check) => check.status === "pending");
    const value = {
      root: args.projectRoot,
      compliant: !failed && !pending,
      complete: !pending,
      checks,
      pendingActions: args.compact ? compactPendingActions(plan.actions) : plan.actions,
    };
    if (args.json) console.log(JSON.stringify(value, null, 2));
    else {
      console.log(`Sentinel verification: ${value.compliant ? "PASS" : pending && !failed ? "INCOMPLETE" : "FAIL"}`);
      for (const check of checks) console.log(`- ${check.status.toUpperCase()} ${check.id}: ${check.detail}`);
    }
    if (failed) process.exitCode = 1;
    else if (pending) process.exitCode = 2;
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
