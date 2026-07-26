#!/usr/bin/env node
// managed-by: gitflow-sentinel (skill tooling)
// Server-side enforcement: configure GitHub branch protection so the policy
// holds even outside any local hook — a force-push or direct push to a protected
// branch is rejected by GitHub itself, no matter how git is invoked or whether
// the hooks are installed on the pusher's machine. This is the strongest layer
// and complements the local ones.
//
// Requires an authenticated `gh`. Read-only by default; --apply makes changes.
// Never deletes branches or repos; only sets protection on stable + integration.
import path from "node:path";
import { run, isFailure, isNotFound, nextValue, resolveProjectRoot } from "./lib.mjs";
import { loadConfig } from "../assets/templates/runtime/.gitflow-sentinel/core/config.mjs";

function parseArgs(argv) {
  const args = { projectRoot: ".", apply: false, reviewers: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--project-root") { args.projectRoot = nextValue(argv, i, a); i += 1; }
    else if (a === "--apply") args.apply = true;
    else if (a === "--dry-run") args.apply = false;
    else if (a === "--reviewers") { args.reviewers = Number(nextValue(argv, i, a)); i += 1; }
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

// Distinguishes "gh is genuinely not on PATH" (ENOENT) from a spawn that failed
// for another reason — e.g. on Windows, execFileSync cannot invoke a .cmd/.ps1
// shim directly without a shell, which some non-standard gh installs (npm
// wrappers, certain package-manager shims) use. Without this, both cases print
// the same "gh CLI not found" message even when gh is installed and works fine
// from an interactive shell, sending the user down the wrong troubleshooting path.
function ghAvailable() {
  const v = run("gh", ["--version"]);
  if (!isFailure(v)) return { available: true };
  if (isNotFound(v)) return { available: false, reason: "not found on PATH" };
  return { available: false, reason: `found but failed to run: ${v.message}` };
}

function ghAuthed() {
  const s = run("gh", ["auth", "status"]);
  return !isFailure(s);
}

function repoSlug(root) {
  const out = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], root);
  return isFailure(out) ? "" : String(out).trim();
}

function remoteBranchExists(root, branch) {
  const out = run("git", ["-C", root, "ls-remote", "--heads", "origin", branch], root);
  return !isFailure(out) && String(out).trim().length > 0;
}

// Minimal, sensible protection: no force-push, no deletion, require a PR with at
// least N approving reviews. enforce_admins keeps it honest for everyone.
function protectionPayload(reviewers) {
  return JSON.stringify({
    required_status_checks: null,
    enforce_admins: true,
    required_pull_request_reviews: { required_approving_review_count: Math.max(0, reviewers) },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  });
}

function applyProtection(root, slug, branch, reviewers) {
  return run(
    "gh",
    ["api", "--method", "PUT", "-H", "Accept: application/vnd.github+json", `repos/${slug}/branches/${branch}/protection`, "--input", "-"],
    root,
    { input: protectionPayload(reviewers) },
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node github-protect.mjs --project-root <path> [--apply] [--reviewers <n>]");
    return;
  }
  const root = resolveProjectRoot(args.projectRoot);
  const config = loadConfig(root);

  console.log("gitflow-sentinel github-protect");
  console.log(`Mode: ${args.apply ? "apply" : "dry-run"}`);

  const gh = ghAvailable();
  if (!gh.available) {
    console.log(`- gh CLI unavailable (${gh.reason}).`);
    console.log("  Install GitHub CLI (https://cli.github.com) and run `gh auth login`, then retry.");
    process.exit(1);
  }
  if (!ghAuthed()) {
    console.log("- gh is not authenticated. Run `gh auth login` (needs the `repo` scope), then retry.");
    process.exit(1);
  }
  const slug = repoSlug(root);
  if (!slug) {
    console.log("- could not resolve the GitHub repository (no origin on GitHub?).");
    process.exit(1);
  }
  console.log(`Repository: ${slug}`);

  const targets = [...new Set([config.stableBranch, config.integrationBranch].filter(Boolean))];
  let changed = 0;
  for (const branch of targets) {
    if (!remoteBranchExists(root, branch)) {
      console.log(`- skip ${branch}: not found on origin (push it first).`);
      continue;
    }
    if (!args.apply) {
      console.log(`- would protect ${branch}: no force-push, no deletion, require PR + ${args.reviewers} review(s), enforce on admins.`);
      continue;
    }
    const res = applyProtection(root, slug, branch, args.reviewers);
    if (isFailure(res)) {
      console.log(`- FAILED ${branch}: ${res.message}`);
      console.log("  (Branch protection needs admin rights and is a paid feature on private repos for some plans.)");
    } else {
      console.log(`- protected ${branch}.`);
      changed += 1;
    }
  }

  if (!args.apply) console.log("\nDry-run only. Re-run with --apply to write the protection rules.");
  else console.log(`\nDone. ${changed}/${targets.length} branch(es) protected.`);
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
