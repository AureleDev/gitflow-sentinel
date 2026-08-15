#!/usr/bin/env node
import { nextValue, resolveProjectRoot } from "./lib.mjs";
import { resumeTransaction } from "./core/transaction.mjs";

function parseArgs(argv) {
  const args = { projectRoot: ".", id: "", r3Approvals: [], r3Resolutions: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--project-root") { args.projectRoot = nextValue(argv, i, value); i += 1; }
    else if (value === "--approve-r3") { args.r3Approvals.push(nextValue(argv, i, value)); i += 1; }
    else if (value === "--resolve-r3") { args.r3Resolutions.push(nextValue(argv, i, value)); i += 1; }
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
  if (args.help) console.log("Usage: gitflow-sentinel resume <transaction-id> [--project-root <path>] [--approve-r3 <action-id>] [--resolve-r3 <action-id>:retry|accept] [--json]");
  else {
    if (!args.id) throw new Error("Transaction id is required.");
    const value = resumeTransaction(args.projectRoot, args.id, {
      r3Approvals: args.r3Approvals,
      r3Resolutions: args.r3Resolutions,
    });
    console.log(args.json ? JSON.stringify(value, null, 2) : `Transaction ${args.id}: ${value.status}`);
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
