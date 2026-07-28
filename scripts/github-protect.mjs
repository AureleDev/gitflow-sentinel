#!/usr/bin/env node
// managed-by: gitflow-sentinel (skill tooling)
// Manage one dedicated GitHub ruleset. Existing branch protection and unrelated
// rulesets are never replaced or nulled.
import { run, isFailure, isNotFound, nextValue, resolveProjectRoot } from "./lib.mjs";
import {
  loadConfig,
  assertValidConfig,
} from "../assets/templates/runtime/.gitflow-sentinel/core/config.mjs";
import {
  RULESET_NAME,
  applyRuleset,
  buildRulesetPayload,
  listRulesets,
  normalizeRuleset,
  readRuleset,
  rulesetMatches,
} from "./core/providers/github.mjs";

function parseArgs(argv) {
  const args = { projectRoot: ".", apply: false, reviewers: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--project-root") { args.projectRoot = nextValue(argv, i, value); i += 1; }
    else if (value === "--apply") args.apply = true;
    else if (value === "--dry-run") args.apply = false;
    else if (value === "--reviewers") { args.reviewers = Number(nextValue(argv, i, value)); i += 1; }
    else if (value === "--help" || value === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!Number.isInteger(args.reviewers) || args.reviewers < 0 || args.reviewers > 10) {
    throw new Error("--reviewers must be an integer between 0 and 10.");
  }
  return args;
}

function ghAvailable() {
  const value = run("gh", ["--version"]);
  if (!isFailure(value)) return { available: true };
  if (isNotFound(value)) return { available: false, reason: "not found on PATH" };
  return { available: false, reason: `found but failed to run: ${value.message}` };
}

function repoSlug(root) {
  const out = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], root);
  return isFailure(out) ? "" : String(out).trim();
}

function remoteBranchExists(root, branch) {
  const out = run("git", ["-C", root, "ls-remote", "--heads", "origin", branch], root);
  return !isFailure(out) && String(out).trim().length > 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node github-protect.mjs --project-root <path> [--apply] [--reviewers <n>]");
    return;
  }
  const root = resolveProjectRoot(args.projectRoot);
  const config = assertValidConfig(loadConfig(root));

  console.log("gitflow-sentinel github-protect");
  console.log(`Mode: ${args.apply ? "apply" : "dry-run"}`);

  const gh = ghAvailable();
  if (!gh.available) throw new Error(`gh CLI unavailable (${gh.reason}).`);
  if (isFailure(run("gh", ["auth", "status"]))) throw new Error("gh is not authenticated. Run `gh auth login` and retry.");

  const slug = repoSlug(root);
  if (!slug) throw new Error("Could not resolve the GitHub repository from this project.");
  console.log(`Repository: ${slug}`);

  const configured = [...new Set([config.stableBranch, config.integrationBranch].filter(Boolean))];
  const targets = configured.filter((branch) => {
    const exists = remoteBranchExists(root, branch);
    if (!exists) console.log(`- skip ${branch}: not found on origin.`);
    return exists;
  });
  if (!targets.length) throw new Error("No configured protected branch exists on origin.");

  const current = listRulesets(root, slug);
  if (isFailure(current)) throw new Error(`Could not read existing rulesets: ${current.message}`);
  const existing = current.find((rule) => rule.name === RULESET_NAME);

  if (!args.apply) {
    console.log(`- would ${existing ? "update" : "create"} dedicated ruleset '${RULESET_NAME}' for ${targets.join(", ")}.`);
    console.log(`- require PR + ${args.reviewers} review(s); block deletion and non-fast-forward pushes.`);
    console.log("- unrelated rulesets and branch-protection settings remain untouched.");
    console.log("\nDry-run only. Re-run with --apply to write the ruleset.");
    return;
  }

  const result = applyRuleset(root, slug, existing?.id, buildRulesetPayload(targets, args.reviewers));
  if (isFailure(result)) throw new Error(`Ruleset update failed: ${result.message}`);
  let saved;
  try { saved = JSON.parse(result); } catch { saved = null; }
  const id = saved?.id || existing?.id;
  const verified = id ? readRuleset(root, slug, id) : null;
  if (isFailure(verified)) throw new Error(`Ruleset verification failed: ${verified.message}`);
  if (!rulesetMatches(normalizeRuleset(verified), targets, args.reviewers)) {
    throw new Error("GitHub did not return the expected active ruleset after the update.");
  }
  console.log(`\nDone. Ruleset ${id} protects ${targets.join(", ")}; unrelated settings were preserved.`);
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
