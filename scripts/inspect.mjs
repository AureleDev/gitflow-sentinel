#!/usr/bin/env node
import { parseProjectArgs } from "./core/command-helpers.mjs";
import { inspectProject } from "./core/inspect-project.mjs";

function render(snapshot) {
  const lines = [
    "gitflow-sentinel inspect",
    `Root: ${snapshot.root}`,
    `Project: ${snapshot.project.name}`,
    `Git: ${snapshot.git.isRepo ? `yes (${snapshot.git.branch || "detached"})` : "not initialized"}`,
    `Languages: ${snapshot.technology.languages.join(", ") || "none detected"}`,
    `Package managers: ${snapshot.technology.packageManagers.join(", ") || "none detected"}`,
    `CI workflows: ${snapshot.automation.workflows.join(", ") || "none"}`,
    `Agents: ${Object.entries(snapshot.agents).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "none configured"}`,
    `GitHub: ${snapshot.provider.github.connected ? snapshot.provider.github.slug : "not connected"}`,
  ];
  return lines.join("\n");
}

try {
  const args = parseProjectArgs(process.argv.slice(2), { profile: false, output: false });
  if (args.help) {
    console.log("Usage: gitflow-sentinel inspect [path] [--remote|--offline] [--json]");
  } else {
    const snapshot = inspectProject(args.projectRoot, { remote: args.remote });
    console.log(args.json ? JSON.stringify(snapshot, null, 2) : render(snapshot));
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
