#!/usr/bin/env node
import { parseProjectArgs, createPlanFor, writeJsonOutput } from "./core/command-helpers.mjs";
import { renderPlan } from "./core/planner.mjs";

try {
  const args = parseProjectArgs(process.argv.slice(2));
  if (args.help) console.log("Usage: gitflow-sentinel update [path] [--remote|--offline] [--json] [--output <file>]");
  else {
    const { plan } = createPlanFor(args.projectRoot, args.profile, args.modules, args);
    if (args.output) writeJsonOutput(args.output, plan);
    console.log(args.json ? JSON.stringify(plan, null, 2) : renderPlan(plan));
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
