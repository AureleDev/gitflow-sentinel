#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyAiInstall, planAiInstall } from "./core/ai-install.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version;

function npmInvocation() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => existsSync(candidate));
  return npmCli
    ? { command: process.execPath, prefix: [npmCli], shell: false }
    : { command: "npm", prefix: [], shell: process.platform === "win32" };
}

function installGlobalCli() {
  const npm = npmInvocation();
  const args = [
    ...npm.prefix,
    "install",
    "--global",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    PACKAGE_ROOT,
  ];
  const options = {
    encoding: "utf8",
    env: process.env,
    shell: npm.shell,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
  };
  try {
    execFileSync(npm.command, args, options);
  } catch (error) {
    const diagnostics = `${error.stdout || ""}\n${error.stderr || ""}`;
    if (!/\bEEXIST\b/.test(diagnostics) || !/gitflow-sentinel/i.test(diagnostics)) throw error;
    execFileSync(npm.command, [...args, "--force"], options);
  }
}

function installSkills(homeDir) {
  const results = [];
  for (const family of [
    { agents: ["codex", "opencode"], label: "Codex et OpenCode" },
    { agents: ["claude"], label: "Claude Code" },
  ]) {
    const plan = planAiInstall({ homeDir, agents: family.agents });
    const result = applyAiInstall(plan);
    results.push({
      label: family.label,
      status: result.destinations.every((item) => item.status === "unchanged")
        ? "déjà à jour"
        : "installé",
    });
  }
  return results;
}

try {
  const homeDir = path.resolve(process.env.GITFLOW_SENTINEL_HOME || os.homedir());
  installGlobalCli();
  const skills = installSkills(homeDir);
  console.log(`Gitflow Sentinel ${VERSION} est prêt.`);
  for (const item of skills) console.log(`- ${item.label}: skill ${item.status}`);
  console.log("- Demande naturelle : « Configure-moi ce projet. »");
  console.log("- Raccourci déterministe dans Claude Code : /configure-project");
} catch (error) {
  console.error(`ERROR: installation incomplète: ${error.message}`);
  console.error("Le CLI peut être réparé avec : gitflow-sentinel ai install --all");
  process.exit(1);
}
