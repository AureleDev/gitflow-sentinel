#!/usr/bin/env node
// managed-by: gitflow-sentinel
// Native Git hook enforcement. Unlike the agent-runtime guard (which only fires
// when Codex/Claude use a tool), these run on EVERY git operation — a human
// typing `git commit`, a script, any tool. Same engine, second local enforcement
// surface. Git hooks block with a non-zero exit code but remain bypassable.
//
// Invoked as: node native.mjs <pre-commit|commit-msg|pre-push> [arg]
import { readFileSync } from "node:fs";
import { loadConfig, isProtected, conventionalCommitRegex, commitTypes, conventionalMode } from "../core/config.mjs";
import { readState, stagedDiff } from "../core/git.mjs";
import { scanStagedFiles, scanDiff } from "../core/secrets.mjs";
import { detectScanners, runGitleaksStaged, runCommitlint } from "../core/external.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node native.mjs <pre-commit|commit-msg|pre-push> [commit-msg-file]");
  console.log("Native git hook entrypoint; invoked automatically via core.hooksPath, not normally run by hand.");
  process.exit(0);
}

const event = process.argv[2] || "";
const cwd = process.cwd();
const config = loadConfig(cwd);
const state = readState(cwd);
if (!state.isRepo) process.exit(0);

// Loudly surface a broken config instead of silently applying defaults — a typo
// in protectedBranches must not quietly disable protection.
if (config._valid === false) {
  console.error("gitflow-sentinel (native): invalid .gitflow-sentinel.json; refusing the Git operation.");
  for (const error of config._errors || []) console.error(`  - ${error.field}: ${error.message}`);
  process.exit(1);
}

const scanners = config.delegateScanners ? detectScanners(cwd) : {};

// Override: set the configured marker as an env var, e.g. GITFLOW_OVERRIDE=explicit.
const [ovKey, ovVal] = String(config.overrideMarker).split("=");
function envOverride() {
  const v = process.env[ovKey];
  return Boolean(v) && (!ovVal || String(v).toLowerCase() === ovVal.toLowerCase());
}

function block(lines) {
  console.error("gitflow-sentinel (native):");
  for (const l of lines) console.error(`  - ${l}`);
  console.error(`  Override a deliberate exception with: ${ovKey}=${ovVal || "explicit"} git <command>`);
  console.error("  (Note: secrets and hook-bypass attempts can never be overridden.)");
  process.exit(1);
}

if (event === "pre-commit") {
  const override = envOverride();

  // Protected-branch commits are overridable (a sanctioned one-off).
  if (!override && isProtected(config, state.branch)) {
    block([
      `${state.branch} is protected; commit on a short branch from ${config.integrationBranch} instead.`,
    ]);
  }

  // Secrets are NEVER overridable — too costly once in history.
  if (config.secretsGuard) {
    const hits = [...scanStagedFiles(state.stagedFiles), ...scanDiff(stagedDiff(cwd))];
    let gl = { clean: true };
    if (scanners.gitleaks) gl = runGitleaksStaged(cwd);
    if (hits.length || !gl.clean) {
      const lines = ["staged changes look like they contain secrets:"];
      for (const h of hits) lines.push(`  ${h.file ? `${h.file}: ` : ""}${h.reason}${h.sample ? ` (near: ${h.sample})` : ""}`);
      if (!gl.clean) lines.push("  gitleaks reported a finding (see its output above).");
      lines.push("Unstage the file, add it to .gitignore, or use a secret manager.");
      block(lines);
    }
  }
  process.exit(0);
}

if (event === "commit-msg") {
  const mode = conventionalMode(config);
  if (mode === "off") process.exit(0);
  const file = process.argv[3];

  // Defer to commitlint when the project has it — it is the authoritative,
  // configurable validator. We only fall back to the built-in regex otherwise.
  if (scanners.commitlint) {
    const r = runCommitlint(cwd, file);
    if (!r.ok) {
      console.error("gitflow-sentinel (native): commitlint rejected the message:");
      if (r.output) console.error(r.output.split(/\r?\n/).map((l) => `  ${l}`).join("\n"));
      if (mode === "block") process.exit(1);
    }
    process.exit(0);
  }

  let msg = "";
  try { msg = readFileSync(file, "utf8"); } catch { process.exit(0); }
  const subject = msg.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#")) || "";
  if (subject && !conventionalCommitRegex(config).test(subject) && !/^(Merge|Revert|fixup!|squash!) /.test(subject)) {
    console.error("gitflow-sentinel (native): commit message is not Conventional Commits.");
    console.error(`  - Use: <type>(<scope>): <summary> — types: ${commitTypes(config).join(", ")}`);
    if (mode === "block") process.exit(1);
  }
  process.exit(0);
}

if (event === "pre-push") {
  if (envOverride()) process.exit(0);
  // git feeds "<local_ref> <local_sha> <remote_ref> <remote_sha>" lines on stdin.
  // Fail CLOSED: if we cannot read what is being pushed, refuse rather than wave
  // a possible push to a protected branch through.
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    block([
      "could not read the push ref list from stdin, so the target could not be verified.",
      "Re-run the push; if this persists, check that git is invoking the pre-push hook normally.",
    ]);
  }
  const protectedSet = new Set([...config.protectedBranches, config.legacyBranch].filter(Boolean));
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const remoteRef = parts[2];
    const name = remoteRef.replace(/^refs\/heads\//, "");
    const localSha = parts[1] || "";
    const deleting = /^0+$/.test(localSha);
    if (protectedSet.has(name)) {
      block([
        deleting ? `deleting the remote branch ${name} is blocked.` : `direct push to ${name} is blocked.`,
        `Use PRs: short branch -> ${config.integrationBranch} -> ${config.stableBranch}.`,
      ]);
    }
  }
  process.exit(0);
}

process.exit(0);
