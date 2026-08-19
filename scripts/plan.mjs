#!/usr/bin/env node
import { parseProjectArgs, createPlanFor, writeJsonOutput } from "./core/command-helpers.mjs";
import { renderPlan } from "./core/planner.mjs";
import { compactPlan } from "./core/public-output.mjs";

try {
  const args = parseProjectArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: gitflow-sentinel plan [path] [--profile minimal|standard|hardened|custom] [--modules git,agents,...] [--strategy detect|trunk|git-flow] [--agents codex,claude,opencode] [--create-github --visibility private --github-owner owner] [--verified-command <command>] [--remote|--offline] [--json [--compact]] [--output <file>]");
  } else {
    const { plan } = createPlanFor(args.projectRoot, args.profile, args.modules, args);
    if (args.output) {
      const file = writeJsonOutput(args.output, plan);
      if (!args.json) console.log(`Plan written: ${file}`);
    }
    console.log(args.json ? JSON.stringify(args.compact ? compactPlan(plan) : plan, null, 2) : renderPlan(plan));
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
