#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const temp = mkdtempSync(path.join(os.tmpdir(), "gitflow-sentinel-package-"));
const consumer = path.join(temp, "consumer");

function runNpm(args, cwd, environment = process.env) {
  const options = {
    cwd,
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  };
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
    "scripts/bootstrap.mjs",
    "scripts/core/ai-install.mjs",
    "scripts/core/human-output.mjs",
    "scripts/core/managed-block.mjs",
    "scripts/core/public-output.mjs",
    "scripts/core/setup-flow.mjs",
    "scripts/core/transaction.mjs",
    "scripts/core/technology.mjs",
    "scripts/core/quality-evidence.mjs",
    "scripts/core/modules/registry.mjs",
    "scripts/quality-check.mjs",
    "assets/sentinel/schema.json",
    "references/visuals/index.html",
    "references/visuals/architecture.svg",
    "references/visuals/parcours-humain.svg",
    "references/visuals/parcours-agent.svg",
    "references/visuals/cycle-vie.svg",
    "references/visuals/securite-transactions.svg",
    "references/visuals/plateformes-wsl.svg",
    "references/platform-validation.md",
    "skills/configure-project/SKILL.md",
    ".codex-plugin/plugin.json",
  ]) {
    assert.equal(existsSync(path.join(installed, relative)), true, `archive is missing ${relative}`);
  }
  for (const relative of [
    "docs/validation/live-agent-2026-07-29.md",
    "docs/validation/steve-2026-07-29.md",
    "docs/validation/platform-status-2026-07-29.md",
    "evals/evals.json",
    "tools/validation/validate-package.mjs",
  ]) {
    assert.equal(existsSync(path.join(installed, relative)), false, `archive must exclude ${relative}`);
  }
  assert.equal(
    existsSync(path.join(installed, ".gitflow-sentinel", "activate.mjs")),
    false,
    "the published tool package must not contain a project-local policy runtime",
  );
  runNpm(["run", "prepare"], installed);

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
  assert.equal(execFileSync(process.execPath, [cli, "--version"], {
    cwd: target,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim(), packageVersion);
  const compactSetup = JSON.parse(execFileSync(
    process.execPath,
    [cli, "setup", target, "--plan-only", "--json", "--compact"],
    { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ));
  assert.equal(JSON.stringify(compactSetup).includes("\"content\""), false);
  const fullStatus = JSON.parse(execFileSync(
    process.execPath,
    [cli, "status", target, "--json"],
    { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ));
  const compactStatus = JSON.parse(execFileSync(
    process.execPath,
    [cli, "status", target, "--json", "--compact"],
    { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ));
  assert.equal(JSON.stringify(fullStatus.pendingActions).includes("\"content\""), true);
  assert.equal(JSON.stringify(compactStatus.pendingActions).includes("\"content\""), false);
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

  const globalPrefix = path.join(temp, "global-prefix");
  const automaticHome = path.join(temp, "automatic-home");
  mkdirSync(globalPrefix);
  mkdirSync(automaticHome);
  execFileSync(process.execPath, [path.join(installed, "scripts", "bootstrap.mjs")], {
    cwd: temp,
    encoding: "utf8",
    env: {
      ...process.env,
      GITFLOW_SENTINEL_HOME: automaticHome,
      HOME: automaticHome,
      USERPROFILE: automaticHome,
      npm_config_prefix: globalPrefix,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    existsSync(path.join(automaticHome, ".agents", "skills", "configure-project", "SKILL.md")),
    true,
    "global install did not install the shared AI skill",
  );
  assert.equal(
    existsSync(path.join(automaticHome, ".claude", "skills", "configure-project", "SKILL.md")),
    true,
    "global install did not install the Claude Code skill",
  );
  assert.equal(JSON.parse(readFileSync(path.join(installed, "package.json"), "utf8")).version, packageVersion);
  console.log(`Package validation passed: ${packed[0].filename}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
