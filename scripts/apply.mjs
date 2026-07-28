#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { nextValue } from "./lib.mjs";
import { applyPlan } from "./core/transaction.mjs";

function parseArgs(argv) {
  const args = { plan: "", approval: "", r2Approvals: [], r3Approvals: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--plan") { args.plan = nextValue(argv, i, value); i += 1; }
    else if (value === "--approve") { args.approval = nextValue(argv, i, value); i += 1; }
    else if (value === "--approve-r2") { args.r2Approvals.push(nextValue(argv, i, value)); i += 1; }
    else if (value === "--approve-r3") { args.r3Approvals.push(nextValue(argv, i, value)); i += 1; }
    else if (value === "--json") args.json = true;
    else if (value === "--help" || value === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: gitflow-sentinel apply --plan <file> --approve <plan-hash> [--approve-r2 <group-id>:<group-hash>] [--approve-r3 <action-id>] [--json]");
  } else {
    if (!args.plan || !args.approval) throw new Error("--plan and --approve are required.");
    const plan = JSON.parse(readFileSync(args.plan, "utf8"));
    const transaction = applyPlan(plan, {
      approval: args.approval,
      r2Approvals: args.r2Approvals,
      r3Approvals: args.r3Approvals,
      planFile: path.resolve(args.plan),
    });
    if (args.json) console.log(JSON.stringify(transaction, null, 2));
    else {
      console.log(`Transaction ${transaction.id}: ${transaction.status}`);
      console.log(`Applied ${transaction.completed.length}/${transaction.plan.actions.length} action(s).`);
    }
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
