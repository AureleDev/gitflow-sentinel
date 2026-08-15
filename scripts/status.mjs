#!/usr/bin/env node
import { parseProjectArgs, createPlanFor } from "./core/command-helpers.mjs";
import { listTransactions } from "./core/transaction.mjs";
import { modulesFor } from "./core/config.mjs";
import { compactPendingActions } from "./core/public-output.mjs";

try {
  const args = parseProjectArgs(process.argv.slice(2), { output: false });
  if (args.help) {
    console.log("Usage: gitflow-sentinel status [path] [--remote|--offline] [--json [--compact]]");
  } else {
    const { plan, loaded, snapshot } = createPlanFor(args.projectRoot, args.profile, args.modules, args);
    const transactions = listTransactions(args.projectRoot);
    const remoteRequired = modulesFor(loaded.config).includes("github") && loaded.config.github.manageRuleset;
    const complete = !remoteRequired || snapshot.provider.github.checked;
    const value = {
      root: args.projectRoot,
      compliant: plan.actions.length === 0 && complete,
      complete,
      localCompliant: plan.actions.filter((action) => action.risk !== "R3").length === 0,
      pendingActions: args.compact ? compactPendingActions(plan.actions) : plan.actions,
      recommendations: plan.recommendations,
      transactions,
    };
    if (args.json) console.log(JSON.stringify(value, null, 2));
    else {
      console.log(`Sentinel status: ${value.compliant ? "all configured foundations compliant" : `${value.pendingActions.length} pending action(s)`}`);
      for (const action of value.pendingActions) console.log(`- ${action.risk} ${action.id}: ${action.description}`);
      if (transactions.length) {
        console.log("\nTransactions:");
        for (const transaction of transactions) console.log(`- ${transaction.id}: ${transaction.status}`);
      }
    }
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
