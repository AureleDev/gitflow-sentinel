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
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { containsSecretMaterial } from "../../scripts/core/security.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const parsedArgs = parseArgs(process.argv.slice(2));
mkdirSync(parsedArgs.workspace, { recursive: true });
const temp = mkdtempSync(path.join(parsedArgs.workspace, "gitflow-sentinel-project-matrix-"));
const consumer = path.join(temp, "consumer");
const excludedDirectoryNames = new Set([
  ".git",
  ".next",
  ".output",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "venv",
]);

function parseArgs(argv) {
  const sources = [];
  let profile = "standard";
  let workspace = os.tmpdir();
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--source") {
      const source = argv[i + 1];
      if (!source) throw new Error("--source needs a directory.");
      sources.push(path.resolve(source));
      i += 1;
    } else if (value === "--profile") {
      profile = argv[i + 1];
      i += 1;
    } else if (value === "--workspace") {
      workspace = path.resolve(argv[i + 1] || "");
      if (!argv[i + 1]) throw new Error("--workspace needs a directory.");
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!sources.length) throw new Error("Provide at least one --source <project>.");
  if (!["minimal", "standard", "hardened"].includes(profile)) throw new Error("--profile must be minimal, standard, or hardened.");
  for (const source of sources) {
    if (!existsSync(source) || !statSync(source).isDirectory()) throw new Error(`Source is not a directory: ${source}`);
    const relative = path.relative(source, workspace);
    if (relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
      throw new Error(`Workspace must stay outside source project: ${source}`);
    }
  }
  return { sources, profile, workspace };
}

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
    timeout: 180_000,
  });
}

function git(target, ...args) {
  return run("git", ["-C", target, ...args], target).trim();
}

function treeEntries(target) {
  const lines = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (directory === target && entry.name === ".git") continue;
      const full = path.join(directory, entry.name);
      const relative = path.relative(target, full).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) lines.push(`link:${relative}`);
      else if (entry.isDirectory()) {
        lines.push(`dir:${relative}`);
        visit(full);
      } else if (entry.isFile()) {
        lines.push(`file:${relative}:${lstatSync(full).mode & 0o777}:${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
      }
    }
  }
  visit(target);
  return lines;
}

function treeDigest(lines) {
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

function treeDiff(before, after) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    removed: before.filter((line) => !afterSet.has(line)).slice(0, 50),
    added: after.filter((line) => !beforeSet.has(line)).slice(0, 50),
  };
}

function approvalArgs(plan) {
  return plan.approvalGroups.flatMap((group) => ["--approve-r2", `${group.id}:${group.hash}`]);
}

function shouldCopy(sourceRoot, candidate) {
  const relative = path.relative(sourceRoot, candidate);
  if (!relative) return true;
  const parts = relative.split(path.sep);
  if (parts.some((part) => excludedDirectoryNames.has(part))) return false;
  if ([".agent", ".agents"].includes(parts[0]) && parts[1] === "skills") return false;
  if (parts[0] === ".claude" && ["skills", "worktrees"].includes(parts[1])) return false;
  if (parts[0] === ".gitflow-sentinel" && ["logs", "backups"].includes(parts[1])) return false;
  if (existsSync(candidate) && lstatSync(candidate).isFile()) {
    const name = path.basename(candidate).toLowerCase();
    const safeEnvExample = [".env.example", ".env.sample"].includes(name);
    if ((!safeEnvExample && /^\.env(?:\.|$)/.test(name)) ||
        [".npmrc", ".pypirc", ".netrc", "id_rsa", "id_ed25519"].includes(name) ||
        /\.(?:key|pem|p12|pfx)$/i.test(name)) return false;
    try {
      const stat = statSync(candidate);
      if (stat.size <= 2 * 1024 * 1024 && containsSecretMaterial(readFileSync(candidate, "utf8"))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

try {
  const { sources, profile } = parsedArgs;
  mkdirSync(consumer);
  const packedResult = JSON.parse(runNpm(["pack", root, "--json", "--pack-destination", temp], root));
  const packed = Array.isArray(packedResult) ? packedResult : Object.values(packedResult);
  assert.equal(packed.length, 1);
  const archive = path.join(temp, packed[0].filename);
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], consumer);
  const cli = path.join(consumer, "node_modules", "gitflow-sentinel", "scripts", "cli.mjs");
  const results = [];

  for (const [index, source] of sources.entries()) {
    const target = path.join(temp, `project-${index + 1}-${path.basename(source)}`);
    cpSync(source, target, { recursive: true, filter: (candidate) => shouldCopy(source, candidate) });
    git(target, "init", "-b", "main");
    git(target, "config", "user.name", "Sentinel Project Matrix");
    git(target, "config", "user.email", "sentinel-project-matrix@example.invalid");
    git(target, "config", "core.longpaths", "true");
    git(target, "add", ".");
    git(target, "commit", "-m", "baseline");
    const baselineEntries = treeEntries(target);
    const baseline = treeDigest(baselineEntries);
    const snapshot = JSON.parse(run(process.execPath, [cli, "inspect", target, "--json"], target));
    const planFile = path.join(temp, `project-${index + 1}-plan.json`);
    const plan = JSON.parse(run(process.execPath, [
      cli,
      "plan",
      target,
      "--profile",
      profile,
      "--output",
      planFile,
      "--json",
    ], target));
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
    ], target));
    assert.equal(transaction.status, "completed");
    const secondPlan = JSON.parse(run(process.execPath, [cli, "plan", target, "--profile", profile, "--json"], target));
    assert.equal(secondPlan.actions.length, 0, `${path.basename(source)} is not idempotent`);
    run(process.execPath, [cli, "rollback", transaction.id, "--project-root", target, "--json"], target);
    const restoredEntries = treeEntries(target);
    assert.deepEqual(
      { digest: treeDigest(restoredEntries), diff: treeDiff(baselineEntries, restoredEntries) },
      { digest: baseline, diff: { removed: [], added: [] } },
      `${path.basename(source)} rollback differs from baseline`,
    );
    assert.equal(git(target, "status", "--porcelain"), "", `${path.basename(source)} rollback left Git changes`);
    results.push({
      project: path.basename(source),
      profile,
      languages: snapshot.technology.languages,
      packageManagers: snapshot.technology.packageManagers,
      monorepo: snapshot.technology.monorepo,
      actions: plan.summary.actions,
      r1: plan.summary.byRisk.R1,
      r2: plan.summary.byRisk.R2,
      idempotent: true,
      rollbackByteExact: true,
    });
  }

  console.log(JSON.stringify({ status: "passed", archive: packed[0].filename, projects: results }, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
