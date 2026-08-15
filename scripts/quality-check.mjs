#!/usr/bin/env node
import { nextValue, resolveProjectRoot } from "./lib.mjs";
import { createQualityCheck, executeQualityCheck } from "./core/quality-evidence.mjs";

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  const optionArgs = separator >= 0 ? argv.slice(0, separator) : argv;
  const command = separator >= 0 ? argv.slice(separator + 1) : [];
  const args = { projectRoot: ".", approval: "", timeoutMs: 300_000, json: false, help: false, command };
  let positional = false;
  for (let i = 0; i < optionArgs.length; i += 1) {
    const value = optionArgs[i];
    if (value === "--project-root") { args.projectRoot = nextValue(optionArgs, i, value); i += 1; }
    else if (value === "--approve") { args.approval = nextValue(optionArgs, i, value); i += 1; }
    else if (value === "--timeout-ms") { args.timeoutMs = Number(nextValue(optionArgs, i, value)); i += 1; }
    else if (value === "--json") args.json = true;
    else if (value === "--help" || value === "-h") args.help = true;
    else if (!value.startsWith("-") && !positional) { args.projectRoot = value; positional = true; }
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1_000 || args.timeoutMs > 3_600_000) {
    throw new Error("--timeout-ms must be an integer between 1000 and 3600000.");
  }
  args.projectRoot = resolveProjectRoot(args.projectRoot);
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: gitflow-sentinel check [path] [--approve <check-hash>] [--timeout-ms 300000] [--json] -- <executable> [args...]");
  } else {
    const check = createQualityCheck(args.projectRoot, args.command);
    if (!args.approval) {
      if (args.json) console.log(JSON.stringify(check, null, 2));
      else {
        console.log(`Quality check: ${check.command}`);
        console.log(`Risk: ${check.risk}`);
        console.log(`Hash: ${check.hash}`);
        console.log(`Run only this reviewed command with: gitflow-sentinel check ${JSON.stringify(args.projectRoot)} --approve ${check.hash} -- ${check.command}`);
        console.log("No command was executed.");
      }
    } else {
      const evidence = executeQualityCheck(check, { approval: args.approval, timeoutMs: args.timeoutMs });
      console.log(args.json
        ? JSON.stringify(evidence, null, 2)
        : `Quality check passed and evidence ${evidence.hash} was recorded without storing command output.`);
    }
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
