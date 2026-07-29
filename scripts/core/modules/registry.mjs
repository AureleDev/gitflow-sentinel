const REQUIRED_METHODS = ["detect", "recommend", "plan", "apply", "verify", "rollback", "uninstall"];

const DEFINITIONS = [
  { id: "git", actionTypes: ["write-file", "merge-managed-block", "merge-json", "git-init", "git-config"] },
  { id: "git-policy", actionTypes: ["write-file", "merge-managed-block", "merge-json", "git-config"] },
  { id: "github", actionTypes: ["github-create", "github-ruleset"] },
  { id: "agents", actionTypes: ["write-file", "merge-managed-block", "merge-json"] },
  { id: "docs", actionTypes: ["write-file", "merge-managed-block"] },
  { id: "quality", actionTypes: ["write-file", "merge-json"] },
  { id: "ci", actionTypes: ["write-file"] },
  { id: "security", actionTypes: ["write-file", "merge-managed-block", "merge-json"] },
  { id: "dependencies", actionTypes: ["write-file"] },
  { id: "release", actionTypes: ["write-file", "merge-managed-block"] },
];

function defineModule(definition, order) {
  const actionTypes = new Set(definition.actionTypes);
  const module = {
    id: definition.id,
    order,
    actionTypes,
    detect(context) {
      return Boolean(context?.enabled?.has(definition.id));
    },
    recommend(context) {
      return context?.recommend ? context.recommend(definition.id) : [];
    },
    plan(context) {
      if (typeof context?.plan !== "function") throw new Error(`Module ${definition.id} needs a deterministic plan adapter.`);
      return context.plan(definition.id);
    },
    apply(context) {
      const action = context?.action;
      if (!actionTypes.has(action?.type)) {
        throw new Error(`Module ${definition.id} cannot apply action type ${action?.type || "<missing>"}.`);
      }
      const handler = context?.handlers?.[action.type];
      if (typeof handler !== "function") throw new Error(`No deterministic handler exists for ${action.type}.`);
      return handler(action);
    },
    verify(context) {
      const pending = (context?.actions || []).filter((action) => action.module === definition.id);
      return { module: definition.id, compliant: pending.length === 0, pending: pending.length };
    },
    rollback(context) {
      if (typeof context?.handler !== "function") throw new Error(`Module ${definition.id} needs a rollback adapter.`);
      return context.handler(context.record);
    },
    uninstall(context) {
      return module.rollback(context);
    },
  };
  for (const method of REQUIRED_METHODS) {
    if (typeof module[method] !== "function") throw new Error(`Module ${definition.id} is missing lifecycle method ${method}.`);
  }
  return Object.freeze(module);
}

export const MODULE_REGISTRY = new Map(
  DEFINITIONS.map((definition, order) => [definition.id, defineModule(definition, order)]),
);

export const MODULE_ORDER = Object.freeze([...MODULE_REGISTRY.keys()]);
export const MODULE_NAMES = new Set(MODULE_ORDER);

export function getModule(id) {
  const module = MODULE_REGISTRY.get(id);
  if (!module) throw new Error(`Unknown Sentinel module: ${id}.`);
  return module;
}

export function enabledModules(ids) {
  const unique = [...new Set(ids || [])];
  const modules = unique.map(getModule);
  return modules.sort((a, b) => a.order - b.order);
}

export function assertModuleAction(action) {
  const module = getModule(action?.module);
  if (!module.actionTypes.has(action?.type)) {
    throw new Error(`Module ${module.id} does not support action type ${action?.type || "<missing>"}.`);
  }
  return action;
}
