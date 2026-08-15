import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { assertModuleAction } from "./modules/registry.mjs";

export const CONTRACT_VERSION = 1;
export const PLAN_KIND = "gitflow-sentinel/change-plan";
export const SNAPSHOT_KIND = "gitflow-sentinel/project-snapshot";
export const CONFIG_KIND = "gitflow-sentinel/desired-state";
export const TRANSACTION_KIND = "gitflow-sentinel/transaction";
export const RISKS = new Set(["R0", "R1", "R2", "R3"]);
const ACTION_TYPES = new Set(["write-file", "merge-managed-block", "merge-json", "git-init", "git-config", "github-create", "github-ruleset"]);
const HASH_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".terraform",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
  "venv",
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(canonical(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashFile(file) {
  return existsSync(file) ? sha256(readFileSync(file)) : null;
}

export function directoryHash(root, { exclude = [] } = {}) {
  const excluded = new Set(exclude.map((file) => path.resolve(file).toLowerCase()));
  function visit(directory) {
    const entries = [];
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (excluded.has(path.resolve(full).toLowerCase())) continue;
      const relative = path.relative(root, full).replaceAll("\\", "/");
      if (entry.isDirectory() && HASH_IGNORED_DIRECTORIES.has(entry.name)) continue;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) entries.push(`link:${relative}`);
      else if (stat.isDirectory()) {
        const children = visit(full);
        if (children.length) entries.push(`dir:${relative}`, ...children);
      } else if (stat.isFile()) entries.push(`file:${relative}:${hashFile(full)}`);
      else entries.push(`other:${relative}`);
    }
    return entries;
  }
  return sha256(visit(root).join("\n"));
}

export function createId(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

export function planHash(plan) {
  const copy = { ...plan };
  delete copy.hash;
  return sha256(stableJson(copy));
}

export function approvalGroups(actions) {
  const modules = [...new Set(actions.filter((action) => action.risk === "R2").map((action) => action.module))].sort();
  return modules.map((module) => {
    const actionIds = actions.filter((action) => action.risk === "R2" && action.module === module).map((action) => action.id);
    const id = `r2-${module}`;
    return { id, risk: "R2", module, actionIds, hash: sha256(stableJson({ id, actionIds })) };
  });
}

export function finalizePlan(plan) {
  const value = {
    kind: PLAN_KIND,
    schemaVersion: CONTRACT_VERSION,
    createdAt: new Date().toISOString(),
    ...plan,
    approvalGroups: approvalGroups(plan.actions || []),
  };
  return { ...value, hash: planHash(value) };
}

export function assertPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("Plan must be a JSON object.");
  if (plan.kind !== PLAN_KIND || plan.schemaVersion !== CONTRACT_VERSION) throw new Error("Unsupported plan contract.");
  if (!Array.isArray(plan.actions)) throw new Error("Plan actions must be an array.");
  if (stableJson(plan.approvalGroups || []) !== stableJson(approvalGroups(plan.actions))) {
    throw new Error("Plan approval groups are invalid.");
  }
  if (plan.hash !== planHash(plan)) throw new Error("Plan hash is invalid; the plan was modified.");
  for (const action of plan.actions) {
    if (!action?.id || !action?.module || !action?.type || !RISKS.has(action?.risk)) {
      throw new Error(`Invalid plan action: ${action?.id || "<unknown>"}.`);
    }
    if (!ACTION_TYPES.has(action.type)) throw new Error(`Unsupported plan action type: ${action.type}.`);
    assertModuleAction(action);
    if (action.target) {
      const target = String(action.target).replaceAll("\\", "/");
      if (path.isAbsolute(action.target) || target === ".." || target.startsWith("../") || target.includes("/../") ||
          target === ".git" || target.startsWith(".git/")) {
        throw new Error(`Unsafe plan target: ${action.target}.`);
      }
    }
  }
  return plan;
}

export function filePrecondition(file) {
  return { exists: existsSync(file), sha256: hashFile(file) };
}
