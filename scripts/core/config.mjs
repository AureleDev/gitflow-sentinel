import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_KIND, CONTRACT_VERSION } from "./contracts.mjs";
import { containsSecretMaterial } from "./security.mjs";
import { MODULE_NAMES } from "./modules/registry.mjs";
import { validateConfig as validateLegacyConfig } from "../../assets/templates/runtime/.gitflow-sentinel/core/config.mjs";

export const CONFIG_FILE = "sentinel.config.json";

export const PROFILE_MODULES = {
  minimal: ["git", "agents", "security"],
  standard: ["git", "github", "agents", "docs", "quality", "ci", "security", "dependencies", "release"],
  hardened: ["git", "git-policy", "github", "agents", "docs", "quality", "ci", "security", "dependencies", "release"],
  custom: [],
};

export const DEFAULT_DESIRED_STATE = {
  kind: CONFIG_KIND,
  schemaVersion: CONTRACT_VERSION,
  profile: "standard",
  project: {
    name: "",
    visibility: "private",
    description: "",
    license: "MIT",
  },
  vcs: {
    provider: "github",
    strategy: "trunk",
    stableBranch: "main",
    integrationBranch: "main",
    legacyBranch: "master",
    protectedBranches: ["main"],
  },
  agents: {
    enabled: ["codex"],
  },
  github: {
    createRepository: false,
    owner: "",
    reviewers: 1,
    manageRuleset: true,
  },
  quality: {
    verifiedCommands: [],
  },
  modules: {
    enabled: [],
  },
};

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function merge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? copy(override) : copy(base);
  if (base && typeof base === "object") {
    const out = { ...base };
    for (const [key, value] of Object.entries(override || {})) {
      out[key] = key in base ? merge(base[key], value) : value;
    }
    return out;
  }
  return override === undefined ? base : override;
}

function addUnknownKeyErrors(errors, field, value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push({ field: field ? `${field}.${key}` : key, message: "is not a supported property" });
  }
}

export function modulesFor(config) {
  return config.profile === "custom" ? config.modules.enabled : PROFILE_MODULES[config.profile];
}

export function validateDesiredState(value) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const str = (field, input, allowEmpty = false) => {
    if (typeof input !== "string" || (!allowEmpty && !input.trim())) add(field, "must be a non-empty string");
  };
  const strings = (field, input, allowEmpty = false) => {
    if (!Array.isArray(input) || (!allowEmpty && input.length === 0) || input.some((item) => typeof item !== "string" || !item.trim())) {
      add(field, "must be an array of non-empty strings");
    }
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) return [{ field: "$", message: "must be an object" }];
  addUnknownKeyErrors(errors, "", value, new Set(["kind", "schemaVersion", "profile", "project", "vcs", "agents", "github", "quality", "modules"]));
  addUnknownKeyErrors(errors, "project", value.project, new Set(["name", "visibility", "description", "license"]));
  addUnknownKeyErrors(errors, "vcs", value.vcs, new Set(["provider", "strategy", "stableBranch", "integrationBranch", "legacyBranch", "protectedBranches"]));
  addUnknownKeyErrors(errors, "agents", value.agents, new Set(["enabled"]));
  addUnknownKeyErrors(errors, "github", value.github, new Set(["createRepository", "owner", "reviewers", "manageRuleset"]));
  addUnknownKeyErrors(errors, "quality", value.quality, new Set(["verifiedCommands"]));
  addUnknownKeyErrors(errors, "modules", value.modules, new Set(["enabled"]));
  if (value.kind !== CONFIG_KIND) add("kind", `must equal ${CONFIG_KIND}`);
  if (value.schemaVersion !== CONTRACT_VERSION) add("schemaVersion", `must equal ${CONTRACT_VERSION}`);
  if (!Object.hasOwn(PROFILE_MODULES, value.profile)) add("profile", "must be minimal, standard, hardened, or custom");
  str("project.name", value.project?.name);
  if (!["private", "public", "internal"].includes(value.project?.visibility)) add("project.visibility", "must be private, public, or internal");
  str("project.description", value.project?.description, true);
  str("project.license", value.project?.license);
  if (!["github"].includes(value.vcs?.provider)) add("vcs.provider", "must be github in V1");
  if (!["trunk", "git-flow"].includes(value.vcs?.strategy)) add("vcs.strategy", "must be trunk or git-flow");
  for (const field of ["stableBranch", "integrationBranch", "legacyBranch"]) str(`vcs.${field}`, value.vcs?.[field]);
  strings("vcs.protectedBranches", value.vcs?.protectedBranches);
  if (new Set(value.vcs?.protectedBranches || []).size !== (value.vcs?.protectedBranches || []).length) {
    add("vcs.protectedBranches", "must contain unique branch names");
  }
  strings("agents.enabled", value.agents?.enabled);
  if (new Set(value.agents?.enabled || []).size !== (value.agents?.enabled || []).length) add("agents.enabled", "must contain unique agents");
  if (value.agents?.enabled?.some((agent) => !["codex", "claude", "opencode"].includes(agent))) {
    add("agents.enabled", "contains an unsupported agent");
  }
  if (value.github?.createRepository !== undefined && typeof value.github.createRepository !== "boolean") add("github.createRepository", "must be boolean");
  if (value.github?.manageRuleset !== undefined && typeof value.github.manageRuleset !== "boolean") add("github.manageRuleset", "must be boolean");
  str("github.owner", value.github?.owner, true);
  if (!Number.isInteger(value.github?.reviewers) || value.github.reviewers < 0 || value.github.reviewers > 10) {
    add("github.reviewers", "must be an integer between 0 and 10");
  }
  strings("quality.verifiedCommands", value.quality?.verifiedCommands, true);
  if (value.quality?.verifiedCommands?.some((command) => /[\r\n\0]/.test(command))) {
    add("quality.verifiedCommands", "commands must each be a single line");
  }
  strings("modules.enabled", value.modules?.enabled, true);
  if (value.modules?.enabled?.some((name) => !MODULE_NAMES.has(name))) add("modules.enabled", "contains an unsupported module");
  if (new Set(value.modules?.enabled || []).size !== (value.modules?.enabled || []).length) add("modules.enabled", "must contain unique modules");
  if (value.profile === "custom" && !value.modules?.enabled?.length) add("modules.enabled", "must not be empty for the custom profile");
  if (value.profile === "custom" && value.modules?.enabled?.length && !value.modules.enabled.includes("git")) {
    add("modules.enabled", "must include git in V1 because transaction state is stored in the repository Git directory");
  }
  if (containsSecretMaterial(JSON.stringify(value))) add("$", "contains a secret-like value; reference an environment variable or provider secret instead");
  return errors;
}

export function assertDesiredState(value) {
  const errors = validateDesiredState(value);
  if (errors.length) throw new Error(`Invalid ${CONFIG_FILE}: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
  return value;
}

export function desiredFromSnapshot(snapshot, {
  profile = "standard",
  modules = [],
  agents = [],
  verifiedCommands = [],
  createGitHub = false,
  visibility = "",
  githubOwner = "",
  strategy = "",
  reviewers,
} = {}) {
  const detectedAgents = [
    snapshot.agents?.codex ? "codex" : "",
    snapshot.agents?.claude ? "claude" : "",
    snapshot.agents?.opencode ? "opencode" : "",
  ].filter(Boolean);
  const detectedStrategy = snapshot.git.isRepo && snapshot.git.branches.includes("dev") ? "git-flow" : "trunk";
  const selectedStrategy = strategy && strategy !== "detect" ? strategy : detectedStrategy;
  const stableBranch = snapshot.git.defaultBranch || "main";
  const integrationBranch = selectedStrategy === "git-flow"
    ? (snapshot.git.branches.includes("dev") ? "dev" : "dev")
    : stableBranch;
  const value = merge(DEFAULT_DESIRED_STATE, {
    profile,
    project: {
      name: snapshot.project.name,
      description: snapshot.project.description || "",
      ...(visibility ? { visibility } : {}),
    },
    vcs: {
      strategy: selectedStrategy,
      stableBranch,
      integrationBranch,
      protectedBranches: [...new Set([stableBranch, integrationBranch])],
    },
    agents: agents.length
      ? { enabled: agents }
      : detectedAgents.length
        ? { enabled: detectedAgents }
        : {},
    github: {
      createRepository: createGitHub,
      owner: githubOwner,
      ...(reviewers === undefined ? {} : { reviewers }),
    },
    quality: { verifiedCommands },
  });
  value.modules.enabled = profile === "custom" ? modules : modulesFor(value);
  return value;
}

export function migrateLegacyConfig(root, base) {
  const file = path.join(root, ".gitflow-sentinel.json");
  if (!existsSync(file)) return { config: base, legacy: null };
  let legacy;
  try {
    legacy = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { config: base, legacy: { file, valid: false, error: error.message } };
  }
  const errors = validateLegacyConfig(legacy);
  if (containsSecretMaterial(JSON.stringify(legacy))) {
    errors.push({ field: "$", message: "contains a secret-like value; move it out of Sentinel configuration" });
  }
  if (errors.length) {
    return {
      config: base,
      legacy: {
        file,
        valid: false,
        error: errors.map((item) => `${item.field}: ${item.message}`).join("; "),
      },
    };
  }
  const migrated = merge(base, {
    vcs: {
      stableBranch: legacy.stableBranch,
      integrationBranch: legacy.integrationBranch,
      legacyBranch: legacy.legacyBranch,
      protectedBranches: legacy.protectedBranches,
      strategy: legacy.integrationBranch === legacy.stableBranch ? "trunk" : "git-flow",
    },
  });
  return { config: migrated, legacy: { file, valid: true } };
}

export function loadDesiredState(root, snapshot, options = {}) {
  const file = path.join(root, CONFIG_FILE);
  if (!existsSync(file)) {
    const initial = desiredFromSnapshot(snapshot, options);
    const { config, legacy } = migrateLegacyConfig(root, initial);
    if (legacy && !legacy.valid) {
      throw new Error(`Invalid .gitflow-sentinel.json: ${legacy.error}. The file was not overwritten.`);
    }
    return { config: assertDesiredState(config), source: legacy?.valid ? "legacy-migration" : "generated", legacy };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${CONFIG_FILE}: ${error.message}. The file was not overwritten.`);
  }
  return { config: assertDesiredState(merge(DEFAULT_DESIRED_STATE, parsed)), source: "file", legacy: null };
}

export function serializeDesiredState(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}
