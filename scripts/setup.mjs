#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { parseProjectArgs, createPlanFor } from "./core/command-helpers.mjs";
import { renderSetupCompletion, renderSetupSummary } from "./core/human-output.mjs";
import { collectSetupApprovals } from "./core/setup-flow.mjs";
import { renderPlan } from "./core/planner.mjs";
import { applyPlan } from "./core/transaction.mjs";
import { compactPlan, compactSnapshot } from "./core/public-output.mjs";

async function main() {
  const args = parseProjectArgs(process.argv.slice(2), { setup: true });
  if (args.help) {
    console.log("Usage: gitflow-sentinel setup [path] [--profile minimal|standard|hardened|custom] [--strategy git-flow|trunk|detect] [--agents codex,claude,opencode] [--remote|--offline] [--plan-only] [--verbose] [--json [--compact]]");
    return;
  }

  const interactive = Boolean(input.isTTY && output.isTTY);
  let reader = null;
  const ask = async ({ message, defaultYes = false }) => {
    reader ||= createInterface({ input, output });
    const answer = (await reader.question(`${message} ${defaultYes ? "[O/n]" : "[o/N]"} `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return ["o", "oui", "y", "yes"].includes(answer);
  };
  try {
    let selectedProfile = args.profile;
    let selectedModules = args.modules;
    let selectedStrategy = args.strategy;
    let strategyWasSelected = args.provided.strategy;
    const hasDesiredState = existsSync(path.join(args.projectRoot, "sentinel.config.json"));
    if (interactive && !args.json && !args.planOnly && !hasDesiredState && !args.provided.strategy) {
      const gitFlow = await ask({
        kind: "branch-strategy",
        defaultYes: true,
        message: "Utiliser le standard Git Flow avec main stable, dev pour l’intégration et des branches courtes ?",
      });
      selectedStrategy = gitFlow ? "git-flow" : "trunk";
      strategyWasSelected = true;
    }

    const planOptions = {
      ...args,
      strategy: selectedStrategy,
      provided: { ...args.provided, strategy: strategyWasSelected },
    };
    const { snapshot, plan } = createPlanFor(args.projectRoot, selectedProfile, selectedModules, planOptions);
    if (args.json) {
      console.log(JSON.stringify({
        snapshot: args.compact ? compactSnapshot(snapshot) : snapshot,
        plan: args.compact ? compactPlan(plan) : plan,
        applied: false,
      }, null, 2));
      return;
    }

    console.log(renderSetupSummary(snapshot, plan));
    if (args.verbose) console.log(`\n${renderPlan(plan)}`);
    if (!plan.actions.length) {
      console.log(`\n${renderSetupCompletion(snapshot, plan)}`);
      return;
    }
    if (args.planOnly || !interactive) {
      console.log("\nAucun changement appliqué. Relancez cette commande dans un terminal interactif pour approuver le plan.");
      return;
    }

    const approvals = await collectSetupApprovals(plan, ask);
    if (!approvals) {
      console.log("\nConfiguration annulée. Aucun changement appliqué.");
      return;
    }
    const transaction = applyPlan(plan, approvals);
    const verified = createPlanFor(args.projectRoot, selectedProfile, selectedModules, planOptions).plan;
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
    reader?.close();
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
