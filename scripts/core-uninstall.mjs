#!/usr/bin/env node
import path from "node:path";
import { nextValue, resolveProjectRoot } from "./lib.mjs";
import { sha256, stableJson } from "./core/contracts.mjs";
import { listTransactions, loadTransaction, rollbackTransaction } from "./core/transaction.mjs";

function parseArgs(argv) {
  const args = { projectRoot: ".", approval: "", json: false };
  let positional = false;
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--project-root") { args.projectRoot = nextValue(argv, i, value); i += 1; }
    else if (value === "--approve") { args.approval = nextValue(argv, i, value); i += 1; }
    else if (value === "--json") args.json = true;
    else if (value === "--help" || value === "-h") args.help = true;
    else if (!value.startsWith("-") && !positional) { args.projectRoot = value; positional = true; }
    else throw new Error(`Unknown argument: ${value}`);
  }
  args.projectRoot = resolveProjectRoot(args.projectRoot);
  return args;
}

function uninstallPlan(root) {
  const all = listTransactions(root);
  const transactions = all
    .filter((item) => item.status === "completed")
    .map((item) => loadTransaction(root, item.id).value)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const value = {
    kind: "gitflow-sentinel/uninstall-plan",
    schemaVersion: 1,
    root: path.resolve(root),
    blockers: all
      .filter((item) => ["applying", "failed", "partial-rollback", "invalid"].includes(item.status))
      .map((item) => ({ id: item.id, status: item.status })),
    transactions: transactions.map((transaction) => ({
      id: transaction.id,
      planHash: transaction.plan.hash,
      localActions: transaction.completed.filter((item) => item.result?.reversible).map((item) => item.actionId),
      externalActions: transaction.completed.filter((item) => !item.result?.reversible).map((item) => item.actionId),
    })),
  };
  return { ...value, hash: sha256(stableJson(value)) };
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: gitflow-sentinel uninstall [path] [--approve <uninstall-hash>] [--json]");
  } else {
    const plan = uninstallPlan(args.projectRoot);
    if (!args.approval) {
      if (args.json) console.log(JSON.stringify(plan, null, 2));
      else {
        console.log(`Uninstall plan: ${plan.hash}`);
        if (!plan.transactions.length) console.log("- No completed Sentinel Core transaction is installed.");
        for (const blocker of plan.blockers) console.log(`- BLOCKED ${blocker.id}: transaction status is ${blocker.status}`);
        for (const transaction of plan.transactions) {
          console.log(`- restore ${transaction.id}: ${transaction.localActions.length} local action(s)`);
          if (transaction.externalActions.length) {
            console.log(`  defer ${transaction.externalActions.length} external action(s) to a separately approved compensating plan`);
          }
        }
        console.log(`\nApply with: gitflow-sentinel uninstall ${JSON.stringify(args.projectRoot)} --approve ${plan.hash}`);
      }
    } else {
      if (args.approval !== plan.hash) throw new Error("Approval hash does not match the current uninstall plan.");
      if (plan.blockers.length) throw new Error("Uninstall is blocked until applying/failed/partial transactions are resumed or rolled back.");
      const results = [];
      for (const transaction of plan.transactions) {
        try {
          const restored = rollbackTransaction(args.projectRoot, transaction.id);
          results.push({ id: transaction.id, status: restored.status });
        } catch (error) {
          results.push({ id: transaction.id, status: "partial-rollback", error: error.message });
          throw new Error(`Uninstall stopped at ${transaction.id}: ${error.message}`);
        }
      }
      const result = { status: "uninstalled", planHash: plan.hash, transactions: results };
      console.log(args.json ? JSON.stringify(result, null, 2) : `Uninstalled ${results.length} Sentinel Core transaction(s).`);
    }
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
