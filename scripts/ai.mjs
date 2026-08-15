#!/usr/bin/env node
import { planAiInstall, applyAiInstall } from "./core/ai-install.mjs";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, agents: [], dryRun: false, json: false, help: false };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--agents") {
      const next = rest[index + 1];
      if (!next) throw new Error("--agents needs a comma-separated value.");
      args.agents = next.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (value === "--all") args.agents = ["codex", "claude", "opencode"];
    else if (value === "--dry-run") args.dryRun = true;
    else if (value === "--json") args.json = true;
    else if (value === "--help" || value === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command || ["--help", "-h"].includes(args.command)) {
    console.log("Usage: gitflow-sentinel ai install [--all|--agents codex,claude,opencode] [--dry-run] [--json]");
  } else if (args.command !== "install") {
    throw new Error(`Unknown ai command: ${args.command}. Use 'ai install'.`);
  } else {
    const plan = planAiInstall({ agents: args.agents });
    const result = applyAiInstall(plan, { dryRun: args.dryRun });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const item of result.destinations) {
        const verb = args.dryRun ? `Prévu (${item.status})` : item.status === "unchanged" ? "Déjà à jour" : "Installé";
        console.log(`${verb} pour ${item.agents.join(", ")} : ${item.destination}`);
      }
      if (!args.dryRun) console.log("Redémarrez l'agent si le skill configure-project n'apparaît pas encore.");
    }
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
