import { groupDescription } from "./human-output.mjs";
import { PROFILE_MODULES } from "./config.mjs";

export function withLocalGitPolicy(profile = "standard") {
  const modules = PROFILE_MODULES[profile];
  if (!modules?.length) throw new Error(`Profile ${profile} cannot be extended with local Git policy.`);
  return {
    profile,
    modules: [],
  };
}

export async function collectSetupApprovals(plan, ask) {
  if (!plan.actions.length) {
    return { approval: plan.hash, r2Approvals: [], r3Approvals: [] };
  }
  if (!await ask({
    kind: "plan",
    message: "Appliquer ce plan exact maintenant ?",
  })) return null;

  const r2Approvals = [];
  for (const group of plan.approvalGroups) {
    if (!await ask({
      kind: "r2",
      id: group.id,
      message: `Autoriser ${groupDescription(plan, group)} ?`,
    })) return null;
    r2Approvals.push(`${group.id}:${group.hash}`);
  }

  const r3Approvals = [];
  for (const action of plan.actions.filter((item) => item.risk === "R3")) {
    if (!await ask({
      kind: "r3",
      id: action.id,
      message: `Autoriser l'action GitHub suivante : ${action.description} ?`,
    })) return null;
    r3Approvals.push(action.id);
  }

  return { approval: plan.hash, r2Approvals, r3Approvals };
}
