#!/usr/bin/env node
import { nextValue, resolveProjectRoot } from "./lib.mjs";
import { rollbackTransaction } from "./core/transaction.mjs";

function parseArgs(argv) {
  const args = { projectRoot: ".", id: "", json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--project-root") { args.projectRoot = nextValue(argv, i, value); i += 1; }
    else if (value === "--json") args.json = true;
    else if (value === "--help" || value === "-h") args.help = true;
    else if (!value.startsWith("-") && !args.id) args.id = value;
    else throw new Error(`Unknown argument: ${value}`);
  }
  args.projectRoot = resolveProjectRoot(args.projectRoot);
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) console.log("Usage: gitflow-sentinel rollback <transaction-id> [--project-root <path>] [--json]");
  else {
    if (!args.id) throw new Error("Transaction id is required.");
    const value = rollbackTransaction(args.projectRoot, args.id);
    console.log(args.json ? JSON.stringify(value, null, 2) : `Transaction ${args.id}: ${value.status}`);
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
