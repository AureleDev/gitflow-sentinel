#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "gitflow-sentinel-self-host-"));
const consumer = path.join(temp, "consumer");
const brownfield = path.join(temp, "sentinel-copy");
const greenfield = path.join(temp, "greenfield");

function runNpm(args, cwd) {
  const options = { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => existsSync(candidate));
  if (npmCli) return execFileSync(process.execPath, [npmCli, ...args], options);
  return execFileSync("npm", args, { ...options, shell: process.platform === "win32" });
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
}

function git(target, ...args) {
  return run("git", ["-C", target, ...args], target).trim();
}

function treeDigest(target) {
  const lines = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (directory === target && entry.name === ".git") continue;
      const full = path.join(directory, entry.name);
      const relative = path.relative(target, full).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) {
        lines.push(`link:${relative}`);
      } else if (entry.isDirectory()) {
        lines.push(`dir:${relative}`);
        visit(full);
      } else if (entry.isFile()) {
        const mode = lstatSync(full).mode & 0o777;
        const digest = createHash("sha256").update(readFileSync(full)).digest("hex");
        lines.push(`file:${relative}:${mode}:${digest}`);
      }
    }
  }
  visit(target);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

function approvalArgs(plan) {
  return plan.approvalGroups.flatMap((group) => ["--approve-r2", `${group.id}:${group.hash}`]);
}

try {
  mkdirSync(consumer);
  mkdirSync(greenfield);
  const packedResult = JSON.parse(runNpm(["pack", root, "--json", "--pack-destination", temp], root));
  const packed = Array.isArray(packedResult) ? packedResult : Object.values(packedResult);
  assert.equal(packed.length, 1);
  const archive = path.join(temp, packed[0].filename);
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], consumer);
  const installed = path.join(consumer, "node_modules", "gitflow-sentinel");
  const cli = path.join(installed, "scripts", "cli.mjs");
  assert.equal(existsSync(cli), true);

  cpSync(root, brownfield, {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return first !== ".git" && first !== "node_modules";
    },
  });
  git(brownfield, "init", "-b", "main");
  git(brownfield, "config", "user.name", "Sentinel Self Host");
  git(brownfield, "config", "user.email", "sentinel-self-host@example.invalid");
  git(brownfield, "add", ".");
  git(brownfield, "commit", "-m", "baseline");
  const baseline = treeDigest(brownfield);

  const inspect = JSON.parse(run(process.execPath, [cli, "inspect", brownfield, "--json"], brownfield));
  assert.equal(inspect.project.name, "gitflow-sentinel");
  assert.equal(inspect.provider.github.checked, false);

  const planFile = path.join(temp, "brownfield-plan.json");
  const plan = JSON.parse(run(process.execPath, [
    cli,
    "plan",
    brownfield,
    "--profile",
    "minimal",
    "--output",
    planFile,
    "--json",
  ], brownfield));
  assert.ok(plan.actions.length > 0);
  assert.equal(plan.summary.byRisk.R3, 0);
  const transaction = JSON.parse(run(process.execPath, [
    cli,
    "apply",
    "--plan",
    planFile,
    "--approve",
    plan.hash,
    ...approvalArgs(plan),
    "--json",
  ], brownfield));
  assert.equal(transaction.status, "completed");

  const verification = JSON.parse(run(process.execPath, [
    cli,
    "verify",
    brownfield,
    "--profile",
    "minimal",
    "--json",
  ], brownfield));
  assert.equal(verification.compliant, true);
  const secondPlan = JSON.parse(run(process.execPath, [
    cli,
    "plan",
    brownfield,
    "--profile",
    "minimal",
    "--json",
  ], brownfield));
  assert.equal(secondPlan.actions.length, 0);

  run(process.execPath, [cli, "rollback", transaction.id, "--project-root", brownfield, "--json"], brownfield);
  assert.equal(treeDigest(brownfield), baseline);
  assert.equal(git(brownfield, "status", "--porcelain"), "");

  const reinstallPlan = JSON.parse(run(process.execPath, [
    cli,
    "plan",
    brownfield,
    "--profile",
    "minimal",
    "--output",
    planFile,
    "--json",
  ], brownfield));
  run(process.execPath, [
    cli,
    "apply",
    "--plan",
    planFile,
    "--approve",
    reinstallPlan.hash,
    ...approvalArgs(reinstallPlan),
    "--json",
  ], brownfield);
  const uninstall = JSON.parse(run(process.execPath, [cli, "uninstall", brownfield, "--json"], brownfield));
  run(process.execPath, [cli, "uninstall", brownfield, "--approve", uninstall.hash, "--json"], brownfield);
  assert.equal(treeDigest(brownfield), baseline);
  assert.equal(git(brownfield, "status", "--porcelain"), "");

  const greenfieldPlanFile = path.join(temp, "greenfield-plan.json");
  const greenfieldPlan = JSON.parse(run(process.execPath, [
    cli,
    "init",
    greenfield,
    "--profile",
    "minimal",
    "--output",
    greenfieldPlanFile,
    "--json",
  ], greenfield));
  const greenfieldTransaction = JSON.parse(run(process.execPath, [
    cli,
    "apply",
    "--plan",
    greenfieldPlanFile,
    "--approve",
    greenfieldPlan.hash,
    ...approvalArgs(greenfieldPlan),
    "--json",
  ], greenfield));
  assert.equal(greenfieldTransaction.status, "completed");
  run(process.execPath, [cli, "rollback", greenfieldTransaction.id, "--project-root", greenfield, "--json"], greenfield);
  assert.deepEqual(readdirSync(greenfield), []);

  console.log(JSON.stringify({
    status: "passed",
    archive: packed[0].filename,
    brownfieldActions: plan.actions.length,
    brownfieldIdempotent: true,
    rollbackByteExact: true,
    uninstallByteExact: true,
    greenfieldReturnedEmpty: true,
  }, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
