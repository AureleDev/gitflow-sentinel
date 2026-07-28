import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { run, isFailure, detectHookManager } from "../lib.mjs";
import { CONTRACT_VERSION, SNAPSHOT_KIND, directoryHash, sha256 } from "./contracts.mjs";
import { githubLocalState, inspectGitHubProvider } from "./providers/github.mjs";
import { inspectTechnology } from "./technology.mjs";

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

function namesIn(root, relative) {
  const dir = path.join(root, relative);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function gitValue(root, args) {
  const value = run("git", ["-C", root, ...args], root);
  return isFailure(value) ? "" : String(value).trim();
}

function redactText(value) {
  return String(value || "")
    .replace(/(https?:\/\/)[^/\s@]+@/gi, "$1<redacted>@")
    .replace(/([?&](?:access_token|token|secret|password|api[_-]?key)=)[^&#\s]+/gi, "$1<redacted>")
    .replace(/\b(gh[pousr]_|github_pat_|glpat-|sk-(?:proj-)?|xox[baprs]-|npm_)[A-Za-z0-9_-]{8,}\b/g, "<redacted-secret>")
    .replace(/\b((?:access[_-]?token|api[_-]?key|auth[_-]?token|password|secret)\s*=\s*)[^\s]+/gi, "$1<redacted>");
}

function sanitizeRemote(value) {
  return redactText(value);
}

export function inspectProject(root, { remote: inspectRemote = false, remoteTimeoutMs = 5_000 } = {}) {
  const packageJson = readJson(path.join(root, "package.json"));
  const technology = inspectTechnology(root);
  const top = gitValue(root, ["rev-parse", "--show-toplevel"]);
  const isRepo = Boolean(top);
  const status = isRepo ? gitValue(root, ["status", "--porcelain", "--untracked-files=all"]) : "";
  const branches = isRepo
    ? gitValue(root, ["branch", "--format=%(refname:short)"]).split(/\r?\n/).filter(Boolean)
    : [];
  const remoteRaw = isRepo ? gitValue(root, ["remote", "get-url", "origin"]) : "";
  const remote = sanitizeRemote(remoteRaw);
  const defaultBranch = isRepo
    ? (gitValue(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).replace(/^origin\//, "") ||
      (branches.includes("main") ? "main" : branches[0] || "main"))
    : "main";
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object"
    ? Object.fromEntries(Object.entries(packageJson.scripts).map(([name, command]) => [name, redactText(command)]))
    : {};
  const manager = detectHookManager(root);

  return {
    kind: SNAPSHOT_KIND,
    schemaVersion: CONTRACT_VERSION,
    inspectedAt: new Date().toISOString(),
    root: path.resolve(root),
    environment: {
      platform: process.platform,
      node: process.versions.node,
    },
    project: {
      name: packageJson?.name || path.basename(root),
      description: redactText(packageJson?.description || ""),
      workspaceHash: isRepo ? "" : directoryHash(root),
    },
    git: {
      isRepo,
      topLevel: top,
      branch: isRepo ? gitValue(root, ["branch", "--show-current"]) : "",
      head: isRepo ? gitValue(root, ["rev-parse", "HEAD"]) : "",
      dirty: Boolean(status),
      statusHash: isRepo ? sha256(status) : "",
      defaultBranch,
      branches,
      remotes: remote ? [{ name: "origin", url: remote, provider: remote.includes("github.com") ? "github" : "unknown" }] : [],
      hooksPath: isRepo ? gitValue(root, ["config", "--local", "core.hooksPath"]) : "",
      hookManager: manager?.name || "",
      longPaths: isRepo ? gitValue(root, ["config", "--get", "core.longpaths"]).toLowerCase() === "true" : false,
      longPathsLocal: isRepo ? gitValue(root, ["config", "--local", "--get", "core.longpaths"]) : "",
    },
    technology: {
      ...technology,
      scripts,
    },
    automation: {
      workflows: namesIn(root, ".github/workflows"),
      dependabot: existsSync(path.join(root, ".github/dependabot.yml")) || existsSync(path.join(root, ".github/dependabot.yaml")),
    },
    documentation: {
      readme: ["README.md", "README.rst", "README"].find((file) => existsSync(path.join(root, file))) || "",
      license: ["LICENSE", "LICENSE.md", "COPYING"].find((file) => existsSync(path.join(root, file))) || "",
      contributing: existsSync(path.join(root, "CONTRIBUTING.md")),
      security: existsSync(path.join(root, "SECURITY.md")),
      codeOfConduct: existsSync(path.join(root, "CODE_OF_CONDUCT.md")),
    },
    agents: {
      agentsMd: existsSync(path.join(root, "AGENTS.md")),
      claudeMd: existsSync(path.join(root, "CLAUDE.md")),
      codex: existsSync(path.join(root, ".codex")),
      claude: existsSync(path.join(root, ".claude")),
      opencode: existsSync(path.join(root, "opencode.json")) || existsSync(path.join(root, ".opencode")),
      portableSkills: existsSync(path.join(root, ".agents/skills")),
    },
    provider: {
      github: inspectRemote
        ? inspectGitHubProvider(root, remote, { timeoutMs: remoteTimeoutMs })
        : githubLocalState(remote),
    },
  };
}
