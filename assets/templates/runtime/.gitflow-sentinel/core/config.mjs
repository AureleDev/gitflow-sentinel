// managed-by: gitflow-sentinel
// Loads the per-project branch/PR policy from `.gitflow-sentinel.json` and
// exposes derived helpers. Keeping every policy decision driven by one config
// object is what lets the same engine serve trunk-based, git-flow, and monorepo
// teams without forking the hook logic.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Conventional Commit types double as short-branch prefixes. A team can shrink
// or extend this list in their config; the defaults cover the common spread.
export const DEFAULT_COMMIT_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

export const DEFAULTS = {
  version: 1,
  stableBranch: "main",
  integrationBranch: "dev",
  // Branches no human/agent should commit to or push to directly.
  protectedBranches: ["main", "dev"],
  // Legacy stable branch that must be normalized before work starts.
  legacyBranch: "master",
  // Prefixes allowed for short work branches, e.g. feat/login.
  shortBranchPrefixes: DEFAULT_COMMIT_TYPES.slice(),
  // Optional: decouple commit-message types from branch prefixes. When unset the
  // two share one vocabulary (shortBranchPrefixes). Set this only if your commit
  // types differ from your branch prefixes.
  commitTypes: null,
  // Which head branches may open a PR against which base. "*" suffix = prefix.
  prRoutes: {
    dev: ["feat/*", "fix/*", "docs/*", "style/*", "refactor/*", "perf/*", "test/*", "build/*", "ci/*", "chore/*", "revert/*", "hotfix/*"],
    main: ["dev", "release/*", "hotfix/*"],
  },
  // Conventional Commits enforcement: "off" | "warn" | "block". Booleans are
  // accepted for back-compat (true -> "warn", false -> "off"). "block" makes the
  // native commit-msg hook reject a non-conforming subject instead of nudging.
  conventionalCommits: "warn",
  secretsGuard: true,
  // History-rewrite protection for already-published, NON-protected branches
  // (e.g. force-pushing your own feature branch after a rebase). "warn" by
  // default because that is a normal, legitimate action that just deserves a
  // heads-up; set "block" to forbid it, "off" to stay silent. Note: force-push,
  // reset, and rewrites on a PROTECTED branch are always blocked by their own
  // rules and are unaffected by this knob.
  historyProtection: "warn",
  // Tag & release governance: "off" | "warn" | "block" for pushing tags and
  // cutting releases (often a production-deploy trigger).
  tagProtection: "warn",
  worktreesAllowed: true, // allowed but only under worktreeRoot with approval
  // Where isolated worktrees should live. Empty means "derive at install time";
  // a runtime fallback message is used if it is still empty.
  worktreeRoot: "",
  // When true, defer to gitleaks / git-secrets / commitlint if they are present
  // and configured, using the built-in checks only as a fallback. This makes the
  // engine cooperate with best-in-class tools instead of duplicating weaker ones.
  delegateScanners: true,
  // Project-facing policy doc the agent guard points readers to. Configurable so
  // a repo that uses docs/CONTRIBUTING.md or no such file is not pointed at a
  // dead path.
  policyDocPath: "CONTRIBUTING.md",
  // Override marker an operator can place in a command/tool input to bypass a
  // single guarded action on purpose. Kept explicit so it shows up in history.
  // The secrets guard can never be overridden by this marker (see policy.mjs).
  overrideMarker: "GITFLOW_OVERRIDE=explicit",
};

// Normalize a tri-state knob that also accepts booleans, to "off" | "warn" |
// "block". Keeps old boolean configs working while enabling the stricter modes.
export function triState(value, fallback = "warn") {
  if (value === true) return "warn";
  if (value === false) return "off";
  if (value === "off" || value === "warn" || value === "block") return value;
  return fallback;
}

export function conventionalMode(config) {
  return triState(config.conventionalCommits, "warn");
}

export function historyMode(config) {
  return triState(config.historyProtection, "block");
}

export function tagMode(config) {
  return triState(config.tagProtection, "warn");
}

export function policyDoc(config) {
  return config.policyDocPath || "CONTRIBUTING.md";
}

// Where a worktree should be created. Falls back to a generic, repo-relative
// location so the warning never reads "Create it under undefined".
export function worktreeRoot(config) {
  return config.worktreeRoot || "../<project>-worktrees";
}

function deepMerge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override.slice() : base.slice();
  if (base && typeof base === "object") {
    const out = { ...base };
    for (const [key, value] of Object.entries(override || {})) {
      out[key] = key in base ? deepMerge(base[key], value) : value;
    }
    return out;
  }
  return override === undefined ? base : override;
}

export function configPath(projectRoot) {
  return path.join(projectRoot, ".gitflow-sentinel.json");
}

// Load merges user config over defaults so a partial file still works. A broken
// JSON file falls back to defaults rather than crashing a hook mid-command.
export function loadConfig(projectRoot = ".") {
  const file = configPath(projectRoot);
  if (!existsSync(file)) return { ...DEFAULTS, _source: "defaults" };
  try {
    const user = JSON.parse(readFileSync(file, "utf8"));
    return { ...deepMerge(DEFAULTS, user), _source: "file" };
  } catch (error) {
    return { ...DEFAULTS, _source: `defaults (invalid config: ${error.message})` };
  }
}

export function commitTypes(config) {
  // Branch prefixes and commit types share a vocabulary by design.
  return config.commitTypes || config.shortBranchPrefixes || DEFAULT_COMMIT_TYPES;
}

export function isProtected(config, branch) {
  return config.protectedBranches.includes(branch) || branch === config.legacyBranch;
}

export function isLegacy(config, branch) {
  return branch === config.legacyBranch;
}

// A short work branch looks like `<prefix>/<something>`, e.g. feat/login.
export function shortBranchRegex(config) {
  const prefixes = config.shortBranchPrefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^(${prefixes.join("|")})/.+`);
}

export function isShortBranch(config, branch) {
  return shortBranchRegex(config).test(branch || "");
}

// Conventional Commits subject regex, built from the configured types. Shared
// by the agent policy engine and the native commit-msg hook so both judge a
// message identically.
export function conventionalCommitRegex(config) {
  const types = commitTypes(config).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^(${types.join("|")})(\\([^)]+\\))?!?: .+`);
}

// Match a head branch against an allowed-route glob list ("dev", "feat/*").
export function headMatchesRoute(routes, head) {
  return (routes || []).some((pattern) => {
    if (pattern.endsWith("/*")) return head.startsWith(pattern.slice(0, -1));
    return head === pattern;
  });
}
