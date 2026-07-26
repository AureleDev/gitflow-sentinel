#!/usr/bin/env node
// managed-by: gitflow-sentinel
// Re-arms the native git hook layer. core.hooksPath is LOCAL git config — it is
// NOT cloned — so without this, a fresh clone has no native enforcement until
// someone re-sets it by hand. This is the same trick husky uses: it is wired
// into package.json "prepare" so it runs on every `npm/pnpm/yarn install`. On a
// non-Node repo (no install step), run it once after cloning:
//   node .gitflow-sentinel/activate.mjs
//
// Idempotent and cooperative: if another hook manager (husky, lefthook) already
// owns core.hooksPath, this does nothing — in that mode gitflow-sentinel is
// injected into that manager's hooks rather than taking the path over.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node .gitflow-sentinel/activate.mjs");
  console.log("Re-arms core.hooksPath after a fresh clone. Run once per clone on a non-Node repo (no `prepare` step).");
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const rel = ".gitflow-sentinel/githooks";

function git(args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// Quietly no-op outside a working repo (e.g. installed from a tarball) or before
// the githooks are present, so a `prepare` run never fails an install.
if (!git(["rev-parse", "--show-toplevel"])) process.exit(0);
if (!existsSync(path.join(root, rel))) process.exit(0);

const current = git(["config", "--local", "core.hooksPath"]);
if (current && current !== rel) process.exit(0); // another manager owns it; injected instead

if (current !== rel) {
  git(["config", "--local", "core.hooksPath", rel]);
  console.error(`gitflow-sentinel: native git hooks re-armed (core.hooksPath=${rel}).`);
}
process.exit(0);
