#!/usr/bin/env node
import { parseProjectArgs, createPlanFor, writeJsonOutput } from "./core/command-helpers.mjs";
import { renderPlan } from "./core/planner.mjs";

try {
  const args = parseProjectArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: gitflow-sentinel init [path] [--profile minimal|standard|hardened|custom] [--modules git,agents,...] [--strategy detect|trunk|git-flow] [--agents codex,claude,opencode] [--create-github --visibility private --github-owner owner] [--verified-command <command>] [--remote|--offline] [--json] [--output <file>]");
  } else {
    const { snapshot, plan } = createPlanFor(args.projectRoot, args.profile, args.modules, args);
    if (args.output) writeJsonOutput(args.output, plan);
    if (args.json) console.log(JSON.stringify(plan, null, 2));
    else {
      console.log(`Mode: ${snapshot.git.isRepo ? "existing repository" : "greenfield"}`);
      console.log(renderPlan(plan));
      if (!args.output) console.log("\nUse --output <file> to save this plan for an explicit apply.");
    }
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
