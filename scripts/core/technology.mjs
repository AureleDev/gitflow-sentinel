import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_DIRECTORIES = 2_000;
const DEFAULT_MAX_MANIFESTS = 1_000;
const DEFAULT_MAX_SOURCE_SIGNALS = 2_000;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".gitflow-sentinel",
  ".hg",
  ".svn",
  ".agent",
  ".agents",
  ".aider",
  ".claude",
  ".codex",
  ".cursor",
  ".gemini",
  ".next",
  ".nuxt",
  ".opencode",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".kiro",
  ".roo",
  ".output",
  ".sentinel",
  ".terraform",
  ".turbo",
  ".venv",
  ".windsurf",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "__pycache__",
  "_bmad",
  "vendor",
  "venv",
]);

const EXACT_MANIFESTS = new Set([
  "Cargo.lock",
  "Cargo.toml",
  "Pipfile",
  "Pipfile.lock",
  "bun.lock",
  "bun.lockb",
  "composer.json",
  "composer.lock",
  "go.mod",
  "go.sum",
  "gradle.lockfile",
  "lerna.json",
  "nx.json",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "poetry.lock",
  "pom.xml",
  "pyproject.toml",
  "turbo.json",
  "uv.lock",
  "yarn.lock",
]);

function isManifest(name) {
  return EXACT_MANIFESTS.has(name) ||
    /^requirements(?:[.-].+)?\.txt$/i.test(name) ||
    /^tsconfig(?:[.-].+)?\.json$/i.test(name) ||
    /^build\.gradle(?:\.kts)?$/i.test(name) ||
    /^settings\.gradle(?:\.kts)?$/i.test(name);
}

function readJson(file) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function relative(root, file) {
  const value = path.relative(root, file).replaceAll("\\", "/");
  return value || ".";
}

function classifyManifest(root, file, languages, managers, packages) {
  const name = path.basename(file);

  if (name === "package.json") {
    languages.add("javascript");
    const value = readJson(file);
    packages.push({
      path: relative(root, path.dirname(file)),
      name: typeof value?.name === "string" ? value.name : "",
      scripts: value?.scripts && typeof value.scripts === "object"
        ? Object.keys(value.scripts).sort()
        : [],
    });
  }
  if (/^tsconfig(?:[.-].+)?\.json$/i.test(name)) languages.add("typescript");
  if (["pyproject.toml", "Pipfile", "Pipfile.lock"].includes(name) || /^requirements(?:[.-].+)?\.txt$/i.test(name)) languages.add("python");
  if (name === "Cargo.toml" || name === "Cargo.lock") languages.add("rust");
  if (name === "go.mod" || name === "go.sum") languages.add("go");
  if (name === "pom.xml" || /^build\.gradle(?:\.kts)?$/i.test(name)) languages.add("java");
  if (name === "composer.json" || name === "composer.lock") languages.add("php");

  if (name === "pnpm-lock.yaml") managers.add("pnpm");
  if (name === "package-lock.json") managers.add("npm");
  if (name === "yarn.lock") managers.add("yarn");
  if (name === "bun.lock" || name === "bun.lockb") managers.add("bun");
  if (name === "uv.lock") managers.add("uv");
  if (name === "poetry.lock") managers.add("poetry");
  if (name === "Pipfile" || name === "Pipfile.lock") managers.add("pipenv");
  if (/^requirements(?:[.-].+)?\.txt$/i.test(name)) managers.add("pip");
  if (name === "Cargo.toml" || name === "Cargo.lock") managers.add("cargo");
  if (name === "go.mod" || name === "go.sum") managers.add("go");
  if (name === "pom.xml") managers.add("maven");
  if (/^(?:build|settings)\.gradle(?:\.kts)?$/i.test(name)) managers.add("gradle");
  if (name === "composer.json" || name === "composer.lock") managers.add("composer");

  return relative(root, file);
}

export function inspectTechnology(root, {
  maxDepth = DEFAULT_MAX_DEPTH,
  maxDirectories = DEFAULT_MAX_DIRECTORIES,
  maxManifests = DEFAULT_MAX_MANIFESTS,
  maxSourceSignals = DEFAULT_MAX_SOURCE_SIGNALS,
} = {}) {
  const languages = new Set();
  const managers = new Set();
  const manifests = [];
  const packages = [];
  const sourceSignals = { python: 0 };
  const queue = [{ directory: path.resolve(root), depth: 0 }];
  let directoriesVisited = 0;
  let truncated = false;
  let sourceSignalsTruncated = false;

  while (queue.length) {
    const { directory, depth } = queue.shift();
    directoriesVisited += 1;
    if (directoriesVisited > maxDirectories) {
      truncated = true;
      break;
    }

    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth && !IGNORED_DIRECTORIES.has(entry.name)) {
          queue.push({ directory: full, depth: depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (/\.py$/i.test(entry.name)) {
        if (sourceSignals.python < maxSourceSignals) {
          sourceSignals.python += 1;
          languages.add("python");
        } else {
          sourceSignalsTruncated = true;
        }
      }
      if (!isManifest(entry.name)) continue;
      manifests.push(classifyManifest(root, full, languages, managers, packages));
      if (manifests.length >= maxManifests) {
        truncated = true;
        queue.length = 0;
        break;
      }
    }
  }

  const rootPackage = readJson(path.join(root, "package.json"));
  const declaredManager = typeof rootPackage?.packageManager === "string"
    ? rootPackage.packageManager.match(/^(npm|pnpm|yarn|bun)(?:@|$)/i)?.[1]?.toLowerCase()
    : "";
  if (declaredManager) managers.add(declaredManager);
  if (rootPackage && !["npm", "pnpm", "yarn", "bun"].some((manager) => managers.has(manager))) {
    managers.add("npm");
  }
  const workspaceMarkers = [
    "pnpm-workspace.yaml",
    "turbo.json",
    "nx.json",
    "lerna.json",
  ].some((name) => existsSync(path.join(root, name)));

  return {
    languages: [...languages].sort(),
    packageManagers: [...managers].sort(),
    monorepo: Boolean(rootPackage?.workspaces || workspaceMarkers || packages.length > 1),
    manifests: manifests.sort(),
    packages: packages.sort((a, b) => a.path.localeCompare(b.path)),
    sourceSignals,
    scan: {
      maxDepth,
      directoriesVisited,
      truncated,
      sourceSignalsTruncated,
    },
  };
}
