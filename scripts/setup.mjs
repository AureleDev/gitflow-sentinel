#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseProjectArgs, createPlanFor } from "./core/command-helpers.mjs";
import { renderSetupSummary } from "./core/human-output.mjs";
import { collectSetupApprovals } from "./core/setup-flow.mjs";
import { renderPlan } from "./core/planner.mjs";
import { applyPlan } from "./core/transaction.mjs";

async function main() {
  const args = parseProjectArgs(process.argv.slice(2), { setup: true });
  if (args.help) {
    console.log("Usage: gitflow-sentinel setup [path] [--profile minimal|standard|hardened|custom] [--agents codex,claude,opencode] [--remote|--offline] [--plan-only] [--verbose] [--json]");
    return;
  }

  const { snapshot, plan } = createPlanFor(args.projectRoot, args.profile, args.modules, args);
  if (args.json) {
    console.log(JSON.stringify({ snapshot, plan, applied: false }, null, 2));
    return;
  }

  console.log(renderSetupSummary(snapshot, plan));
  if (args.verbose) console.log(`\n${renderPlan(plan)}`);
  if (!plan.actions.length) {
    console.log("\nLe projet est déjà conforme à cet état désiré.");
    return;
  }
  if (args.planOnly || !input.isTTY || !output.isTTY) {
    console.log("\nAucun changement appliqué. Relancez cette commande dans un terminal interactif pour approuver le plan.");
    return;
  }

  const reader = createInterface({ input, output });
  const ask = async ({ message }) => {
    const answer = (await reader.question(`${message} [o/N] `)).trim().toLowerCase();
    return ["o", "oui", "y", "yes"].includes(answer);
  };
  try {
    const approvals = await collectSetupApprovals(plan, ask);
    if (!approvals) {
      console.log("\nConfiguration annulée. Aucun changement appliqué.");
      return;
    }
    const transaction = applyPlan(plan, approvals);
    const verified = createPlanFor(args.projectRoot, args.profile, args.modules, args).plan;
    const pendingLocal = verified.actions.filter((action) => action.risk !== "R3");
    console.log(`\nConfiguration terminée : ${transaction.completed.length} action(s) appliquée(s).`);
    console.log(`Restauration disponible : gitflow-sentinel rollback ${transaction.id}`);
    if (pendingLocal.length) {
      console.error(`Vérification locale incomplète : ${pendingLocal.length} action(s) restent à examiner.`);
      process.exitCode = 1;
    } else {
      console.log("Vérification locale réussie.");
    }
  } finally {
    reader.close();
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
