#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { parseProjectArgs, createPlanFor } from "./core/command-helpers.mjs";
import { renderSetupCompletion, renderSetupSummary } from "./core/human-output.mjs";
import { collectSetupApprovals, withLocalGitPolicy } from "./core/setup-flow.mjs";
import { renderPlan } from "./core/planner.mjs";
import { applyPlan } from "./core/transaction.mjs";
import { compactPlan, compactSnapshot } from "./core/public-output.mjs";

async function main() {
  const args = parseProjectArgs(process.argv.slice(2), { setup: true });
  if (args.help) {
    console.log("Usage: gitflow-sentinel setup [path] [--profile minimal|standard|hardened|custom] [--agents codex,claude,opencode] [--remote|--offline] [--plan-only] [--verbose] [--json [--compact]]");
    return;
  }

  const interactive = Boolean(input.isTTY && output.isTTY);
  let reader = null;
  const ask = async ({ message }) => {
    reader ||= createInterface({ input, output });
    const answer = (await reader.question(`${message} [o/N] `)).trim().toLowerCase();
    return ["o", "oui", "y", "yes"].includes(answer);
  };
  try {
    let selectedProfile = args.profile;
    let selectedModules = args.modules;
    const hasDesiredState = existsSync(path.join(args.projectRoot, "sentinel.config.json"));
    if (interactive && !args.json && !args.planOnly && args.profile === "standard" && !hasDesiredState) {
      const localPolicy = await ask({
        kind: "local-policy",
        message: "Ajouter la politique Git locale (retour précoce contournable ; la CI et GitHub restent l'autorité partagée) ?",
      });
      if (localPolicy) {
        ({ profile: selectedProfile, modules: selectedModules } = withLocalGitPolicy("standard"));
      }
    }

    const { snapshot, plan } = createPlanFor(args.projectRoot, selectedProfile, selectedModules, args);
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
    const verified = createPlanFor(args.projectRoot, selectedProfile, selectedModules, args).plan;
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
