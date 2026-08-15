function countBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    const value = item[key] || "other";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name} ${count}`);
}

function languageLabel(value) {
  return {
    javascript: "JavaScript",
    typescript: "TypeScript",
    python: "Python",
    rust: "Rust",
    go: "Go",
    java: "Java",
    php: "PHP",
  }[value] || value;
}

export function renderSetupSummary(snapshot, plan) {
  const local = plan.actions.filter((action) => action.risk !== "R3");
  const remote = plan.actions.filter((action) => action.risk === "R3");
  const additiveActions = local.filter((action) => action.risk === "R1");
  const additions = additiveActions.length;
  const modifications = local.filter((action) => action.risk === "R2").length;
  const agents = plan.desiredState?.agents?.enabled || [];
  const technologies = snapshot.technology.languages.length
    ? snapshot.technology.languages.map(languageLabel).join(", ")
    : "aucune détectée";
  const lines = [
    `Projet : ${snapshot.project.name}`,
    `Technologies : ${technologies}`,
    `Agents IA : ${agents.join(", ") || "codex"}`,
    `Plan : ${plan.actions.length} action(s) — ${additions} ajout(s), ${modifications} modification(s), ${remote.length} action(s) GitHub`,
  ];
  if (plan.actions.length) lines.push(`Modules : ${countBy(plan.actions, "module").join(", ")}`);
  if (additiveActions.length) {
    const labels = additiveActions.map((action) => action.target || action.description);
    const visible = labels.slice(0, 8);
    lines.push(`Ajouts prévus : ${visible.join(", ")}${labels.length > visible.length ? `, +${labels.length - visible.length} autre(s)` : ""}`);
  }
  const decisions = plan.recommendations.filter((item) => ["decision", "error"].includes(item.severity));
  if (decisions.length) {
    lines.push("", "Points à examiner :");
    for (const item of decisions) lines.push(`- ${item.message}`);
  }
  return lines.join("\n");
}

export function groupDescription(plan, group) {
  const actions = plan.actions.filter((action) => group.actionIds.includes(action.id));
  const targets = actions.map((action) => action.target).filter(Boolean);
  const suffix = targets.length
    ? ` (${targets.slice(0, 4).join(", ")}${targets.length > 4 ? ", …" : ""})`
    : "";
  return `${group.module}: ${actions.length} modification(s)${suffix}`;
}

export function renderSetupCompletion(snapshot, plan) {
  const modules = plan.desiredState?.modules?.enabled || [];
  const remoteExpected = modules.includes("github") && plan.desiredState?.github?.manageRuleset;
  if (remoteExpected && !snapshot.provider?.github?.checked) {
    return "La configuration locale est conforme. L’état GitHub n’a pas été vérifié ; relancez avec --remote si ce contrôle est nécessaire.";
  }
  return "Le projet est conforme à cet état désiré.";
}
