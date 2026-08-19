#!/usr/bin/env node
// managed-by: gitflow-sentinel
// CI-side branch routing check. Reads the PR base/head from the GitHub Actions
// environment and validates them against the same config the local hooks use,
// so server enforcement never drifts from local enforcement. Exit 1 on a
// routing violation. Base/head can also be passed as argv for local testing.
import { loadConfig, headMatchesRoute } from "../core/config.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node ci-check.mjs [base] [head]  (or set GITHUB_BASE_REF / GITHUB_HEAD_REF)");
  console.log("CI-side PR routing check; invoked by the gitflow-policy workflow, not normally run by hand.");
  process.exit(0);
}

const base = process.argv[2] || process.env.GITHUB_BASE_REF || "";
const head = process.argv[3] || process.env.GITHUB_HEAD_REF || "";
const config = loadConfig(process.cwd());

if (!base) {
  console.error("gitflow-sentinel CI: no base branch provided.");
  process.exit(1);
}

if (base === config.legacyBranch) {
  console.error(`gitflow-sentinel CI: PRs to ${config.legacyBranch} are not allowed. Use ${config.stableBranch}.`);
  process.exit(1);
}

const routes = config.prRoutes[base];
if (routes && !headMatchesRoute(routes, head)) {
  console.error(`gitflow-sentinel CI: head '${head}' may not target '${base}'.`);
  console.error(`Allowed heads for ${base}: ${routes.join(", ")}`);
  process.exit(1);
}

console.log(`gitflow-sentinel CI: routing OK (${head} -> ${base}).`);
