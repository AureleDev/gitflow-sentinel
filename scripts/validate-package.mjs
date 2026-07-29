#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "gitflow-sentinel-package-"));
const consumer = path.join(temp, "consumer");

function runNpm(args, cwd) {
  const options = { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => existsSync(candidate));
  if (npmCli) {
    return execFileSync(process.execPath, [npmCli, ...args], options);
  }
  return execFileSync("npm", args, { ...options, shell: process.platform === "win32" });
}

try {
  mkdirSync(consumer);
  const rawPacked = JSON.parse(runNpm(["pack", root, "--json", "--pack-destination", temp], root));
  const packed = Array.isArray(rawPacked) ? rawPacked : Object.values(rawPacked);
  assert.equal(packed.length, 1, "npm pack must produce exactly one archive");
  const archive = path.join(temp, packed[0].filename);
  assert.equal(existsSync(archive), true, "npm archive was not created");

  runNpm(
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive],
    consumer,
  );

  const installed = path.join(consumer, "node_modules", "gitflow-sentinel");
  for (const relative of [
    "scripts/cli.mjs",
    "scripts/setup.mjs",
    "scripts/ai.mjs",
    "scripts/core/ai-install.mjs",
    "scripts/core/human-output.mjs",
    "scripts/core/setup-flow.mjs",
    "scripts/core/transaction.mjs",
    "scripts/core/technology.mjs",
    "scripts/core/quality-evidence.mjs",
    "scripts/core/modules/registry.mjs",
    "scripts/quality-check.mjs",
    "assets/sentinel/schema.json",
    "skills/configure-project/SKILL.md",
    ".codex-plugin/plugin.json",
  ]) {
    assert.equal(existsSync(path.join(installed, relative)), true, `archive is missing ${relative}`);
  }

  const target = path.join(temp, "plain-folder");
  mkdirSync(target);
  const cli = path.join(installed, "scripts", "cli.mjs");
  const output = execFileSync(
    process.execPath,
    [cli, "inspect", target, "--json"],
    { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const snapshot = JSON.parse(output);
  assert.equal(snapshot.git.isRepo, false);
  assert.equal(snapshot.kind, "gitflow-sentinel/project-snapshot");
  const setupOutput = execFileSync(
    process.execPath,
    [cli, "setup", target, "--plan-only"],
    { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.match(setupOutput, /Aucun changement appliqué/);
  const fakeHome = path.join(temp, "user-home");
  mkdirSync(fakeHome);
  const aiPreview = JSON.parse(execFileSync(
    process.execPath,
    [cli, "ai", "install", "--all", "--dry-run", "--json"],
    {
      cwd: target,
      encoding: "utf8",
      env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ));
  assert.equal(aiPreview.applied, false);
  assert.deepEqual(aiPreview.agents, ["codex", "claude", "opencode"]);
  assert.equal(aiPreview.destinations.every((item) => item.status === "create"), true);
  assert.equal(readFileSync(path.join(installed, "package.json"), "utf8").includes("3.0.0-alpha.1"), true);
  console.log(`Package validation passed: ${packed[0].filename}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
