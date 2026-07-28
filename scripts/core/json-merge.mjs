import { mergeHooks } from "../lib.mjs";

function deepMerge(base, patch) {
  if (Array.isArray(patch)) return JSON.parse(JSON.stringify(patch));
  if (patch && typeof patch === "object") {
    const out = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
    for (const [key, value] of Object.entries(patch)) out[key] = deepMerge(out[key], value);
    return out;
  }
  return patch;
}

export function mergeJsonValue(existing, action) {
  if (action.strategy === "hooks") return mergeHooks(existing, action.patch);
  if (action.strategy === "package-prepare") {
    const next = deepMerge({}, existing);
    next.scripts = next.scripts && typeof next.scripts === "object" && !Array.isArray(next.scripts)
      ? { ...next.scripts }
      : {};
    const current = typeof next.scripts.prepare === "string" ? next.scripts.prepare : "";
    if (!current.includes(action.addition)) {
      next.scripts.prepare = current ? `${current} && ${action.addition}` : action.addition;
    }
    return next;
  }
  return deepMerge(existing, action.patch);
}

export function serializeMergedJson(existing, action) {
  return `${JSON.stringify(mergeJsonValue(existing, action), null, 2)}\n`;
}
