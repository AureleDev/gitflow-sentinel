import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { inspectProject } from "../scripts/core/inspect-project.mjs";
import { createPlanFor } from "../scripts/core/command-helpers.mjs";
import { loadDesiredState, validateDesiredState } from "../scripts/core/config.mjs";
import { buildPlan } from "../scripts/core/planner.mjs";
import {
  applyPlan,
  listTransactions,
  loadTransaction,
  resumeTransaction,
  rollbackTransaction,
} from "../scripts/core/transaction.mjs";
import { filePrecondition, finalizePlan } from "../scripts/core/contracts.mjs";
import { getModule, MODULE_ORDER } from "../scripts/core/modules/registry.mjs";
import {
  createQualityCheck,
  executeQualityCheck,
  validQualityEvidence,
} from "../scripts/core/quality-evidence.mjs";
import {
  DEFAULT_REMOTE_TIMEOUT_MS,
  buildRulesetPayload,
  githubRepoSlug,
  normalizeRuleset,
  rulesetMatches,
} from "../scripts/core/providers/github.mjs";
import { planAiInstall, applyAiInstall } from "../scripts/core/ai-install.mjs";
import { collectSetupApprovals, withLocalGitPolicy } from "../scripts/core/setup-flow.mjs";
import { renderSetupCompletion, renderSetupSummary } from "../scripts/core/human-output.mjs";
import { compactPendingActions, compactPlan, compactSnapshot } from "../scripts/core/public-output.mjs";
import { mergeManagedBlock } from "../scripts/core/managed-block.mjs";
import {
  analyze,
  isDirectEditTool,
  isShellFileWrite,
} from "../assets/templates/runtime/.gitflow-sentinel/core/parser.mjs";
import {
  filePaths,
  filePathsTouchRoot,
} from "../assets/templates/runtime/.gitflow-sentinel/core/event.mjs";
import { DEFAULTS, validateConfig } from "../assets/templates/runtime/.gitflow-sentinel/core/config.mjs";
import { evaluate, partition } from "../assets/templates/runtime/.gitflow-sentinel/core/policy.mjs";
import { run } from "../scripts/lib.mjs";

function tempProject(prefix = "sentinel-test-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makePlan(root, profile = "standard") {
  const snapshot = inspectProject(root);
  const loaded = loadDesiredState(root, snapshot, { profile });
  return { snapshot, loaded, plan: buildPlan(root, snapshot, loaded.config, loaded) };
}

function approvals(plan, extra = {}) {
  return {
    approval: plan.hash,
    r2Approvals: plan.approvalGroups.map((group) => `${group.id}:${group.hash}`),
    ...extra,
  };
}

test("semantic validators reject unsafe types", () => {
  const legacyErrors = validateConfig({ protectedBranches: null, shortBranchPrefixes: "feat", prRoutes: [] });
  assert.ok(legacyErrors.some((error) => error.field === "protectedBranches"));
  assert.ok(legacyErrors.some((error) => error.field === "shortBranchPrefixes"));
  assert.ok(legacyErrors.some((error) => error.field === "prRoutes"));

  const desiredErrors = validateDesiredState({ kind: "wrong", schemaVersion: 1 });
  assert.ok(desiredErrors.length > 3);

  const custom = makePlanFixtureConfig().loaded;
  custom.profile = "custom";
  custom.modules.enabled = ["docs"];
  assert.ok(validateDesiredState(custom).some((error) =>
    error.field === "modules.enabled" && error.message.includes("must include git")));

  const { loaded } = makePlanFixtureConfig();
  loaded.project.description = "token sk-proj-abcdefghijklmnopqrstuvwxyz";
  loaded.unexpected = true;
  const secretErrors = validateDesiredState(loaded);
  assert.ok(secretErrors.some((error) => error.message.includes("secret-like")));
  assert.ok(secretErrors.some((error) => error.field === "unexpected"));
});

test("failed subprocess diagnostics redact secret-like output", () => {
  const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz";
  const result = run(process.execPath, ["-e", `process.stderr.write(${JSON.stringify(secret)});process.exit(1)`], process.cwd());
  assert.equal(result.message.includes(secret), false);
  assert.equal(result.stderr.includes("<redacted-secret>"), true);
  assert.equal(JSON.stringify(result.error).includes(secret), false);
});

test("direct-edit policy uses repository target paths and cannot be self-overridden", () => {
  const root = path.resolve("policy-target-root");
  const event = {
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "src", "inside.js") },
    tool_uses: [
      { parameters: { notebook_path: path.join(root, "notes.ipynb") } },
    ],
  };
  assert.deepEqual(filePaths(event), [
    path.join(root, "src", "inside.js"),
    path.join(root, "notes.ipynb"),
  ]);
  assert.equal(filePathsTouchRoot(filePaths(event), root, root), true);
  assert.equal(filePathsTouchRoot([path.resolve(root, "..", "agent-memory", "note.md")], root, root), false);
  assert.equal(filePathsTouchRoot([], root, root), null);
  assert.equal(isDirectEditTool("functions.apply_patch"), true);

  const state = {
    isRepo: true,
    branch: "main",
    branches: new Set(["main"]),
    stagedFiles: [],
    remotes: "origin",
    upstream: "origin/main",
  };
  const decisions = (directEditInWorktree, hasOverride = false) => partition(evaluate({
    config: { ...DEFAULTS, stableBranch: "main", integrationBranch: "main", protectedBranches: ["main"] },
    state,
    toolName: "Write",
    directEditInWorktree,
    hasOverride,
    segments: [],
  })).blocks.map((item) => item.code);
  assert.equal(decisions(true).includes("DIRECT_EDIT_PROTECTED"), true);
  assert.equal(decisions(true, true).includes("DIRECT_EDIT_PROTECTED"), true);
  assert.equal(decisions(false).includes("DIRECT_EDIT_PROTECTED"), false);
});

test("shell-write detection distinguishes commands, quoted text, and null sinks", () => {
  const writes = (command) => analyze(command).some((segment) => isShellFileWrite(segment));
  for (const command of [
    "echo ok > /dev/null",
    "echo ok 2>/dev/null",
    "Write-Output ok > $null",
    "echo ok > nul",
    "printf 'rm file'",
    "echo '>'",
    "echo rm",
  ]) assert.equal(writes(command), false, command);
  for (const command of [
    "echo ok > output.txt",
    "echo ok 2>>errors.log",
    "rm file.txt",
    "Set-Content file.txt value",
    "tee output.txt",
  ]) assert.equal(writes(command), true, command);
});

test("standard setup includes local Git policy without becoming a custom profile", () => {
  const selected = withLocalGitPolicy("standard");
  assert.equal(selected.profile, "standard");
  assert.deepEqual(selected.modules, []);
  const root = tempProject("sentinel-local-policy-");
  try {
    const { plan } = createPlanFor(root, selected.profile, selected.modules, { profile: "standard", modules: [], provided: {} });
    assert.equal(plan.desiredState.profile, "standard");
    assert.equal(plan.desiredState.modules.enabled.includes("git-policy"), true);
    assert.equal(plan.actions.some((action) => action.module === "git-policy"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function makePlanFixtureConfig() {
  const root = tempProject();
  try {
    const snapshot = inspectProject(root);
    return { loaded: loadDesiredState(root, snapshot, { profile: "minimal" }).config };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("GitHub global options and unknown PR bases fail closed", () => {
  const merge = analyze("gh --repo owner/repo pr merge 42 --merge");
  assert.equal(merge[0].gh.group, "pr");
  assert.equal(merge[0].gh.subcommand, "merge");

  const api = analyze("gh --repo owner/repo api repos/owner/repo/pulls/42/merge -X PUT");
  const apiDecisions = partition(evaluate({
    config: { ...DEFAULTS },
    state: {
      isRepo: true,
      branch: "feat/test",
      branches: new Set(["main", "dev"]),
      stagedFiles: [],
      remotes: "origin",
      upstream: "origin/feat/test",
    },
    segments: api,
  }));
  assert.ok(apiDecisions.blocks.some((item) => item.code === "PR_MERGE"));

  const unknown = partition(evaluate({
    config: { ...DEFAULTS },
    state: {
      isRepo: true,
      branch: "feat/test",
      branches: new Set(["main", "dev"]),
      stagedFiles: [],
      remotes: "origin",
      upstream: "origin/feat/test",
    },
    segments: analyze("gh pr create --base preview --head feat/test"),
  }));
  assert.ok(unknown.blocks.some((item) => item.code === "PR_UNKNOWN_BASE"));
});

test("GitHub ruleset diff owns only its dedicated policy", () => {
  const payload = buildRulesetPayload(["main", "dev"], 2);
  assert.deepEqual(Object.keys(payload).sort(), [
    "bypass_actors",
    "conditions",
    "enforcement",
    "name",
    "rules",
    "target",
  ]);
  assert.equal("security_and_analysis" in payload, false);
  assert.equal("delete_branch_on_merge" in payload, false);

  const normalized = normalizeRuleset({
    id: 42,
    name: "gitflow-sentinel",
    enforcement: "active",
    conditions: payload.conditions,
    rules: [...payload.rules, { type: "required_signatures" }],
  });
  assert.equal(rulesetMatches(normalized, ["main", "dev"], 2), true);
  assert.equal(rulesetMatches(normalized, ["main", "dev"], 1), false);
});

test("GitHub inspection supports SSH remotes and a bounded slow-network timeout", () => {
  assert.equal(githubRepoSlug("git@github.com:AureleDev/gitflow-sentinel.git"), "AureleDev/gitflow-sentinel");
  assert.equal(githubRepoSlug("ssh://git@github.com/AureleDev/gitflow-sentinel.git"), "AureleDev/gitflow-sentinel");
  assert.equal(githubRepoSlug("https://github.com/AureleDev/gitflow-sentinel.git"), "AureleDev/gitflow-sentinel");
  assert.equal(DEFAULT_REMOTE_TIMEOUT_MS, 15_000);
});

test("planner never mutates an unreadable GitHub ruleset", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const snapshot = inspectProject(root);
  snapshot.provider.github = {
    checked: true,
    available: true,
    authenticated: true,
    connected: true,
    slug: "example/repository",
    visibility: "private",
    defaultBranch: "main",
    permissions: { viewer: "ADMIN" },
    remoteBranches: ["main"],
    ruleset: { readable: false, present: false },
  };
  const loaded = loadDesiredState(root, snapshot, { profile: "standard" });
  const plan = buildPlan(root, snapshot, loaded.config, loaded);
  assert.equal(plan.actions.some((action) => action.type === "github-ruleset"), false);
  assert.ok(plan.recommendations.some((item) =>
    item.module === "github" && item.severity === "error" && item.message.includes("cannot be read")));
});

test("Git Flow remote repair plans push, default branch, and ruleset as separate R3 actions", (t) => {
  const root = tempProject("sentinel-remote-flow-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "sentinel@example.invalid");
  git(root, "config", "user.name", "Sentinel Test");
  writeFileSync(path.join(root, "seed.txt"), "seed\n");
  git(root, "add", "seed.txt");
  git(root, "commit", "-m", "test: seed remote flow");
  const snapshot = inspectProject(root);
  snapshot.provider.github = {
    checked: true,
    available: true,
    authenticated: true,
    connected: true,
    slug: "example/repository",
    visibility: "public",
    defaultBranch: "main",
    permissions: { viewer: "ADMIN" },
    remoteBranches: ["main"],
    ruleset: {
      readable: true,
      present: true,
      id: 42,
      enforcement: "active",
      include: ["refs/heads/main"],
      ruleTypes: ["deletion", "non_fast_forward", "pull_request"],
      reviewers: 1,
    },
  };
  const loaded = loadDesiredState(root, snapshot, { profile: "standard" });
  const plan = buildPlan(root, snapshot, loaded.config, loaded);
  const remoteActions = plan.actions.filter((action) => action.risk === "R3");
  assert.deepEqual(remoteActions.map((action) => action.type), [
    "github-push-branch",
    "github-default-branch",
    "github-ruleset",
  ]);
  assert.equal(remoteActions[0].branchName, "dev");
  assert.equal(remoteActions[1].branchName, "dev");
});

test("all registered modules expose the deterministic lifecycle contract", () => {
  assert.deepEqual(MODULE_ORDER, [
    "git",
    "git-policy",
    "github",
    "agents",
    "docs",
    "quality",
    "ci",
    "security",
    "dependencies",
    "release",
  ]);
  for (const id of MODULE_ORDER) {
    const module = getModule(id);
    for (const method of ["detect", "recommend", "plan", "apply", "verify", "rollback", "uninstall"]) {
      assert.equal(typeof module[method], "function");
    }
  }
});

test("inspection redacts credentials from remote URLs", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "remote", "add", "origin", "https://user:password@github.com/example/private.git");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "redaction-test",
    description: "sk-proj-abcdefghijklmnopqrstuvwxyz",
    scripts: { test: "API_KEY=top-secret-value node --test" },
  }));
  const snapshot = inspectProject(root);
  assert.equal(snapshot.git.remotes[0].url.includes("password"), false);
  assert.equal(snapshot.git.remotes[0].url.includes("<redacted>"), true);
  assert.equal(JSON.stringify(snapshot).includes("abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(JSON.stringify(snapshot).includes("top-secret-value"), false);
});

test("inspection discovers bounded nested workspaces and Python managers without remote access", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "deep-fixture",
    workspaces: ["packages/*"],
  }));
  mkdirSync(path.join(root, "packages", "web"), { recursive: true });
  writeFileSync(path.join(root, "packages", "web", "package.json"), JSON.stringify({ name: "@fixture/web" }));
  writeFileSync(path.join(root, "packages", "web", "tsconfig.json"), "{}\n");
  mkdirSync(path.join(root, "tools", "worker"), { recursive: true });
  writeFileSync(path.join(root, "tools", "worker", "pyproject.toml"), "[project]\nname = \"worker\"\n");
  writeFileSync(path.join(root, "tools", "worker", "uv.lock"), "version = 1\n");
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(path.join(root, "scripts", "standalone.py"), "print('detected')\n");
  mkdirSync(path.join(root, "node_modules", "ignored"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", "ignored", "Cargo.toml"), "[package]\nname = \"ignored\"\n");
  mkdirSync(path.join(root, ".kiro", "skills", "ignored"), { recursive: true });
  writeFileSync(path.join(root, ".kiro", "skills", "ignored", "Cargo.toml"), "[package]\nname = \"ignored-agent-skill\"\n");

  const snapshot = inspectProject(root);
  assert.deepEqual(snapshot.technology.languages, ["javascript", "python", "typescript"]);
  assert.deepEqual(snapshot.technology.packageManagers, ["npm", "uv"]);
  assert.equal(snapshot.technology.monorepo, true);
  assert.equal(snapshot.technology.packages.length, 2);
  assert.equal(snapshot.technology.manifests.some((file) => file.includes("node_modules")), false);
  assert.equal(snapshot.technology.scan.truncated, false);
  assert.equal(snapshot.provider.github.checked, false);
});

test("inspection defaults root package.json to npm and honors packageManager", (t) => {
  const npmRoot = tempProject();
  const pnpmRoot = tempProject();
  t.after(() => {
    rmSync(npmRoot, { recursive: true, force: true });
    rmSync(pnpmRoot, { recursive: true, force: true });
  });
  writeFileSync(path.join(npmRoot, "package.json"), JSON.stringify({ name: "npm-project" }));
  writeFileSync(path.join(pnpmRoot, "package.json"), JSON.stringify({
    name: "pnpm-project",
    packageManager: "pnpm@10.0.0",
  }));

  assert.deepEqual(inspectProject(npmRoot).technology.packageManagers, ["npm"]);
  assert.deepEqual(inspectProject(pnpmRoot).technology.packageManagers, ["pnpm"]);
});

test("standard plans npm Dependabot for a root package without a lockfile", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "npm-project" }));

  const { plan } = makePlan(root, "standard");
  const action = plan.actions.find((candidate) => candidate.target === ".github/dependabot.yml");
  assert.ok(action);
  assert.match(action.content, /package-ecosystem: "npm"/);
  assert.match(action.content, /package-ecosystem: "github-actions"/);
});

test("inspection detects Python source without a package manifest and ignores generated trees", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "main.py"), "print('project')\n");
  mkdirSync(path.join(root, "__pycache__"), { recursive: true });
  writeFileSync(path.join(root, "__pycache__", "cached.py"), "print('ignored')\n");
  mkdirSync(path.join(root, "_bmad", "tools"), { recursive: true });
  writeFileSync(path.join(root, "_bmad", "tools", "workflow.py"), "print('ignored')\n");

  const snapshot = inspectProject(root);
  assert.deepEqual(snapshot.technology.languages, ["python"]);
  assert.equal(snapshot.technology.packageManagers.length, 0);
  assert.equal(snapshot.technology.sourceSignals.python, 1);
});

test("desired state enables agents already present in the inspected project", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  for (const directory of [".codex", ".claude", ".opencode"]) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  const snapshot = inspectProject(root);
  const loaded = loadDesiredState(root, snapshot, { profile: "standard" });
  assert.deepEqual(loaded.config.agents.enabled, ["codex", "claude", "opencode"]);
});

test("standard and hardened both manage the local Git policy runtime", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const standard = makePlan(root, "standard").plan;
  const hardened = makePlan(root, "hardened").plan;
  assert.equal(standard.actions.some((action) => action.module === "git-policy"), true);
  assert.equal(hardened.actions.some((action) => action.module === "git-policy"), true);
});

test("guided setup derives exact R2 and R3 approvals from the reviewed plan", async () => {
  const plan = finalizePlan({
    id: "plan-guided-setup",
    root: path.resolve("."),
    desiredState: {},
    snapshot: {},
    recommendations: [],
    actions: [
      {
        id: "001-docs-write-file",
        module: "docs",
        type: "write-file",
        risk: "R2",
        target: "README.md",
        content: "managed\n",
        description: "Update documentation.",
        precondition: { exists: true, sha256: "fixture" },
      },
      {
        id: "002-github-github-create",
        module: "github",
        type: "github-create",
        risk: "R3",
        description: "Create a private GitHub repository.",
      },
    ],
  });
  const prompts = [];
  const approved = await collectSetupApprovals(plan, async (prompt) => {
    prompts.push(prompt);
    return true;
  });
  assert.equal(approved.approval, plan.hash);
  assert.deepEqual(
    approved.r2Approvals,
    plan.approvalGroups.map((group) => `${group.id}:${group.hash}`),
  );
  assert.deepEqual(approved.r3Approvals, ["002-github-github-create"]);
  assert.deepEqual(prompts.map((prompt) => prompt.kind), ["plan", "r2", "r3"]);

  let asked = 0;
  const refused = await collectSetupApprovals(plan, async () => {
    asked += 1;
    return asked < 2;
  });
  assert.equal(refused, null);
  assert.equal(asked, 2);
});

test("guided setup summary is concise and shows detected project facts", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  writeFileSync(path.join(root, "main.py"), "print('ok')\n");
  const { snapshot, plan } = makePlan(root, "standard");
  const output = renderSetupSummary(snapshot, plan);
  assert.match(output, /Technologies : Python/);
  assert.match(output, /Agents IA : codex/);
  assert.match(output, /Plan : \d+ action\(s\)/);
  assert.equal(output.includes(plan.hash), false);
});

test("compact agent output preserves decisions without embedding generated bodies", (t) => {
  const root = tempProject("sentinel-compact-output-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { snapshot, plan } = makePlan(root, "standard");
  const compact = compactPlan(plan);
  const compactText = JSON.stringify(compact);
  assert.equal(compact.actions.length, plan.actions.length);
  assert.equal(compact.hash, plan.hash);
  assert.deepEqual(compact.approvalGroups, plan.approvalGroups);
  assert.equal(compactText.includes("\"content\""), false);
  assert.equal(compactText.includes("\"precondition\""), false);

  const compactProject = compactSnapshot(snapshot);
  assert.deepEqual(compactProject.technology.languages, snapshot.technology.languages);
  assert.equal(JSON.stringify(compactProject).includes("\"remotes\""), false);

  const compactActions = compactPendingActions(plan.actions);
  assert.equal(compactActions.length, plan.actions.length);
  assert.equal(JSON.stringify(compactActions).includes("\"content\""), false);
});

test("managed blocks use file-appropriate comments and migrate legacy ignore markers", () => {
  const block = ".env\n*.key\n";
  const gitignore = mergeManagedBlock("node_modules/\n", block, "project-foundations", ".gitignore");
  assert.match(gitignore, /# gitflow-sentinel:start project-foundations/);
  assert.equal(gitignore.includes("<!-- gitflow-sentinel:start"), false);

  const legacy = `node_modules/

<!-- gitflow-sentinel:start project-foundations -->
old-value
<!-- gitflow-sentinel:end project-foundations -->
`;
  const migrated = mergeManagedBlock(legacy, block, "project-foundations", ".gitignore");
  assert.match(migrated, /# gitflow-sentinel:start project-foundations/);
  assert.equal(migrated.includes("<!-- gitflow-sentinel:start"), false);
  assert.equal((migrated.match(/gitflow-sentinel:start/g) || []).length, 1);

  const markdown = mergeManagedBlock("", "Managed text", "project-contract", "AGENTS.md");
  assert.match(markdown, /<!-- gitflow-sentinel:start project-contract -->/);
});

test("setup completion distinguishes local compliance from unchecked GitHub state", () => {
  const snapshot = { provider: { github: { checked: false } } };
  const plan = {
    desiredState: {
      modules: { enabled: ["git", "github"] },
      github: { manageRuleset: true },
    },
  };
  assert.match(renderSetupCompletion(snapshot, plan), /configuration locale est conforme/i);
  assert.match(renderSetupCompletion(snapshot, plan), /GitHub n’a pas été vérifié/i);
  snapshot.provider.github.checked = true;
  assert.match(renderSetupCompletion(snapshot, plan), /projet est conforme/i);
});

test("AI skill install is additive, idempotent, and refuses unmanaged conflicts", (t) => {
  const homeDir = tempProject("sentinel-ai-home-");
  const conflictHome = tempProject("sentinel-ai-conflict-");
  const failureHome = tempProject("sentinel-ai-failure-");
  t.after(() => rmSync(homeDir, { recursive: true, force: true }));
  t.after(() => rmSync(conflictHome, { recursive: true, force: true }));
  t.after(() => rmSync(failureHome, { recursive: true, force: true }));
  mkdirSync(path.join(homeDir, ".codex"), { recursive: true });
  mkdirSync(path.join(homeDir, ".claude"), { recursive: true });

  const plan = planAiInstall({ homeDir });
  assert.deepEqual(plan.agents, ["codex", "claude"]);
  assert.deepEqual(plan.destinations.map((item) => item.status), ["create", "create"]);
  const applied = applyAiInstall(plan);
  assert.equal(applied.applied, true);
  assert.equal(existsSync(path.join(homeDir, ".agents", "skills", "configure-project", "SKILL.md")), true);
  assert.equal(existsSync(path.join(homeDir, ".claude", "skills", "configure-project", "SKILL.md")), true);

  const second = planAiInstall({ homeDir });
  assert.deepEqual(second.destinations.map((item) => item.status), ["unchanged", "unchanged"]);
  applyAiInstall(second);
  const managedSkill = path.join(homeDir, ".agents", "skills", "configure-project", "SKILL.md");
  writeFileSync(managedSkill, "first managed drift\n");
  const stale = planAiInstall({ homeDir, agents: ["codex"] });
  writeFileSync(managedSkill, "second managed drift\n");
  assert.throws(() => applyAiInstall(stale), /plan is stale/i);
  assert.equal(readFileSync(managedSkill, "utf8"), "second managed drift\n");

  const unmanaged = path.join(conflictHome, ".agents", "skills", "configure-project");
  mkdirSync(unmanaged, { recursive: true });
  writeFileSync(path.join(unmanaged, "SKILL.md"), "unmanaged\n");
  const conflict = planAiInstall({ homeDir: conflictHome, agents: ["codex"] });
  assert.equal(conflict.destinations[0].status, "conflict");
  assert.equal(applyAiInstall(conflict, { dryRun: true }).applied, false);
  assert.throws(() => applyAiInstall(conflict), /refusing to replace unmanaged skill/i);
  assert.equal(readFileSync(path.join(unmanaged, "SKILL.md"), "utf8"), "unmanaged\n");

  const interrupted = planAiInstall({ homeDir: failureHome, agents: ["codex", "claude"] });
  assert.throws(
    () => applyAiInstall(interrupted, { simulateFailureAfter: 2 }),
    /changes were rolled back/i,
  );
  assert.equal(existsSync(path.join(failureHome, ".agents", "skills", "configure-project")), false);
  assert.equal(existsSync(path.join(failureHome, ".claude", "skills", "configure-project")), false);
});

test("setup plan-only is a one-command read-only greenfield preview", (t) => {
  const root = tempProject("sentinel-setup-preview-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = path.resolve("scripts/cli.mjs");
  const output = execFileSync(
    process.execPath,
    [cli, "setup", root, "--plan-only"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.match(output, /Plan : \d+ action\(s\)/);
  assert.match(output, /Aucun changement appliqué/);
  assert.deepEqual(readdirSync(root), []);
});

test("runtime hooks cover agent tools, allow short-branch push, and bound Stop continuation", (t) => {
  const claudeSettings = JSON.parse(readFileSync(
    path.resolve("assets/templates/claude/.claude/settings.json"),
    "utf8",
  ));
  assert.equal(claudeSettings.hooks.PreToolUse[0].matcher, "*");
  const packageVersion = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")).version;
  const runtimeVersion = readFileSync(
    path.resolve("assets/templates/runtime/.gitflow-sentinel/VERSION"),
    "utf8",
  ).trim();
  assert.equal(runtimeVersion, packageVersion);

  const root = tempProject("sentinel-hook-cycle-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "codex/review-fix");
  git(root, "config", "user.email", "sentinel@example.invalid");
  git(root, "config", "user.name", "Sentinel Test");
  writeFileSync(path.join(root, "tracked.txt"), "fixture\n");
  git(root, "add", "tracked.txt");
  git(root, "commit", "-m", "test: create hook fixture");
  const sha = git(root, "rev-parse", "HEAD");

  const nativeHook = path.resolve("assets/templates/runtime/.gitflow-sentinel/githooks/native.mjs");
  const push = spawnSync(process.execPath, [nativeHook, "pre-push"], {
    cwd: root,
    encoding: "utf8",
    input: `refs/heads/codex/review-fix ${sha} refs/heads/codex/review-fix ${"0".repeat(40)}\n`,
  });
  assert.equal(push.status, 0, push.stderr);

  const stopHook = path.resolve("assets/templates/runtime/.gitflow-sentinel/hooks/cycle-reminder.mjs");
  const stop = spawnSync(process.execPath, [stopHook], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "Stop", stop_hook_active: false }),
  });
  assert.equal(stop.status, 2, stop.stderr);
  assert.match(stop.stderr, /stop blocked once/i);
  const repeatedStop = spawnSync(process.execPath, [stopHook], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "Stop", stop_hook_active: true }),
  });
  assert.equal(repeatedStop.status, 0, repeatedStop.stderr);
  assert.match(repeatedStop.stderr, /allowing termination to avoid a loop/i);

  git(root, "branch", "main");
  git(root, "switch", "main");
  const guard = path.resolve("assets/templates/runtime/.gitflow-sentinel/hooks/guard.mjs");
  const guardCall = (file) => spawnSync(process.execPath, [guard], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      cwd: root,
      tool_input: { file_path: file },
    }),
  });
  const outside = guardCall(path.resolve(root, "..", "agent-memory", "note.md"));
  assert.equal(outside.status, 0, outside.stderr);
  const inside = guardCall(path.join(root, "inside.txt"));
  assert.equal(inside.status, 2, inside.stderr);
  assert.match(inside.stderr, /DIRECT_EDIT_PROTECTED/);
});

test("Git Flow is the default, explicit trunk is preserved, and existing config options are not ignored", (t) => {
  const root = tempProject("sentinel-strategy-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "sentinel@example.invalid");
  git(root, "config", "user.name", "Sentinel Test");
  writeFileSync(path.join(root, "seed.txt"), "seed\n");
  git(root, "add", "seed.txt");
  git(root, "commit", "-m", "test: seed project");

  const initial = createPlanFor(root, "standard", [], { profile: "standard", modules: [], provided: {} });
  assert.equal(initial.plan.desiredState.vcs.strategy, "git-flow");
  assert.equal(initial.plan.desiredState.vcs.integrationBranch, "dev");
  assert.deepEqual(initial.plan.desiredState.vcs.protectedBranches, ["main", "dev"]);
  assert.equal(initial.plan.actions.some((action) => action.type === "git-branch" && action.branchName === "dev"), true);

  const policyAction = initial.plan.actions.find((action) => action.target === ".gitflow-sentinel.json");
  assert.ok(policyAction);
  assert.equal(policyAction.patch.shortBranchPrefixes.includes("codex"), true);
  assert.equal(policyAction.patch.prRoutes.dev.includes("codex/*"), true);
  assert.equal(policyAction.patch.commitTypes.includes("codex"), false);

  const trunkConfig = structuredClone(initial.loaded.config);
  trunkConfig.vcs.strategy = "trunk";
  trunkConfig.vcs.integrationBranch = "main";
  trunkConfig.vcs.protectedBranches = ["main"];
  writeFileSync(path.join(root, "sentinel.config.json"), `${JSON.stringify(trunkConfig, null, 2)}\n`);
  const preserved = createPlanFor(root, "standard", [], { profile: "standard", modules: [], provided: {} });
  assert.equal(preserved.plan.desiredState.vcs.strategy, "trunk");

  const overridden = createPlanFor(root, "standard", [], {
    profile: "standard",
    modules: [],
    strategy: "git-flow",
    provided: { strategy: true },
  });
  assert.equal(overridden.plan.desiredState.vcs.strategy, "git-flow");
  assert.equal(overridden.plan.desiredState.vcs.integrationBranch, "dev");
  assert.equal(overridden.loaded.source, "file-migration");
  assert.equal(overridden.plan.actions.some((action) => action.target === "sentinel.config.json"), true);
});

test("integration branch creation is transactional and rollback preserves later branch work", (t) => {
  const root = tempProject("sentinel-dev-branch-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "sentinel@example.invalid");
  git(root, "config", "user.name", "Sentinel Test");
  writeFileSync(path.join(root, "seed.txt"), "seed\n");
  git(root, "add", "seed.txt");
  git(root, "commit", "-m", "test: seed project");

  const { plan } = createPlanFor(root, "standard", [], { profile: "standard", modules: [], provided: {} });
  const transaction = applyPlan(plan, approvals(plan));
  assert.equal(git(root, "rev-parse", "dev"), git(root, "rev-parse", "main"));
  rollbackTransaction(root, transaction.id);
  assert.throws(() => git(root, "rev-parse", "--verify", "dev"));

  const second = createPlanFor(root, "standard", [], { profile: "standard", modules: [], provided: {} });
  const applied = applyPlan(second.plan, approvals(second.plan));
  const originalDev = git(root, "rev-parse", "dev");
  git(root, "switch", "-c", "feat/advance-dev", "dev");
  writeFileSync(path.join(root, "dev.txt"), "work\n");
  git(root, "add", "dev.txt");
  git(root, "commit", "-m", "test: advance integration fixture");
  const advancedDev = git(root, "rev-parse", "HEAD");
  git(root, "switch", "main");
  git(root, "update-ref", "refs/heads/dev", advancedDev, originalDev);
  assert.throws(() => rollbackTransaction(root, applied.id), /changed after Sentinel created/i);
});

test("quality evidence requires approval, stores no output, and is bound to repository state", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  writeFileSync(path.join(root, "package.json"), "{\"name\":\"quality-fixture\"}\n");
  const secretOutput = "sk-proj-abcdefghijklmnopqrstuvwxyz";
  const check = createQualityCheck(root, [
    process.execPath,
    "-e",
    "process.stdout.write(\"sk-\" + \"proj-\" + \"abcdefghijklmnopqrstuvwxyz\")",
  ]);
  assert.equal(check.risk, "R2");
  assert.throws(() => executeQualityCheck(check, { approval: "wrong" }), /approval hash/i);
  const evidence = executeQualityCheck(check, { approval: check.hash });
  assert.equal(evidence.exitCode, 0);
  assert.equal(JSON.stringify(evidence).includes(secretOutput), false);

  const snapshot = inspectProject(root);
  assert.equal(validQualityEvidence(root, snapshot, [check.command])[check.command]?.hash, evidence.hash);
  const approvedPackage = readFileSync(path.join(root, "package.json"), "utf8");
  writeFileSync(path.join(root, "package.json"), "{\"name\":\"changed-quality-fixture\"}\n");
  const changed = inspectProject(root);
  assert.equal(validQualityEvidence(root, changed, [check.command])[check.command], null);
  assert.throws(() => executeQualityCheck(check, { approval: check.hash }), /stale/i);
  writeFileSync(path.join(root, "package.json"), approvedPackage);

  const evidenceRoot = path.join(git(root, "rev-parse", "--absolute-git-dir"), "sentinel", "quality-evidence");
  const persisted = readdirSync(evidenceRoot)
    .map((name) => readFileSync(path.join(evidenceRoot, name), "utf8"))
    .join("\n");
  assert.equal(persisted.includes(secretOutput), false);
});

test("quality evidence runs an approved Windows command shim without shell injection", {
  skip: process.platform !== "win32",
}, (t) => {
  const root = tempProject("sentinel quality shim ");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  writeFileSync(path.join(root, "package.json"), "{\"name\":\"quality-shim-fixture\"}\n");
  const shim = path.join(root, "quality-check.cmd");
  writeFileSync(shim, "@echo off\r\nif not \"%~1\"==\"safe&literal\" exit /b 9\r\nexit /b 0\r\n");

  const check = createQualityCheck(root, [path.basename(shim, ".cmd"), "safe&literal"]);
  const evidence = executeQualityCheck(check, { approval: check.hash });
  assert.equal(evidence.exitCode, 0);
});

test("plan apply is idempotent and rollback restores prior local state", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    name: "fixture",
    scripts: { lint: "node --check index.js", test: "node --test" },
  }, null, 2)}\n`);
  writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");

  const { plan } = makePlan(root);
  assert.ok(plan.actions.length > 5);
  assert.ok(plan.approvalGroups.length > 0);
  assert.throws(() => applyPlan(plan, { approval: plan.hash }), /needs --approve-r2/);
  const transaction = applyPlan(plan, approvals(plan));
  assert.equal(transaction.status, "completed");
  const managedIgnore = readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.equal(managedIgnore.includes("# gitflow-sentinel:start project-foundations"), true);
  assert.equal(managedIgnore.includes("<!-- gitflow-sentinel:start"), false);

  const after = makePlan(root);
  assert.equal(after.plan.actions.filter((action) => action.risk !== "R3").length, 0);

  const rolledBack = rollbackTransaction(root, transaction.id);
  assert.equal(rolledBack.status, "rolled-back");
  assert.equal(readFileSync(path.join(root, ".gitignore"), "utf8"), "node_modules/\n");
  assert.equal(existsSync(path.join(root, "sentinel.config.json")), false);
  assert.equal(existsSync(path.join(root, "package.json")), true);
});

test("stale plans abort and automatically undo earlier local actions", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const { plan } = makePlan(root, "minimal");
  const firstFile = plan.actions.find((action) => action.type === "write-file");
  assert.ok(firstFile);
  const target = path.join(root, firstFile.target);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, "drift\n");
  assert.throws(() => applyPlan(plan, approvals(plan)), /Plan is stale/);
  assert.equal(readFileSync(target, "utf8"), "drift\n");
});

test("stale plans detect byte changes inside an already dirty unplanned file", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const notes = path.join(root, "notes.txt");
  writeFileSync(notes, "first draft\n");
  const { plan } = makePlan(root, "minimal");
  writeFileSync(notes, "second draft\n");
  assert.throws(() => applyPlan(plan, approvals(plan)), /working tree changed/i);
  assert.equal(readFileSync(notes, "utf8"), "second draft\n");
});

test("transaction lock prevents concurrent apply and stale locks are recoverable", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const { plan } = makePlan(root, "minimal");
  const lockDir = path.join(git(root, "rev-parse", "--absolute-git-dir"), "sentinel");
  const lock = path.join(lockDir, "transaction.lock");
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  assert.throws(() => applyPlan(plan, approvals(plan)), /another Sentinel transaction is active/i);
  rmSync(lock, { force: true });

  writeFileSync(lock, JSON.stringify({ pid: 2_000_000_000, createdAt: new Date(0).toISOString() }));
  const transaction = applyPlan(plan, approvals(plan));
  assert.equal(transaction.status, "completed");
  rollbackTransaction(root, transaction.id);
});

test("rollback restores file bytes and mode metadata", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const target = path.join(root, ".gitignore");
  writeFileSync(target, "existing/\n");
  chmodSync(target, 0o640);
  const beforeMode = statSync(target).mode & 0o777;
  const beforeBytes = readFileSync(target);
  const { plan } = makePlan(root, "minimal");
  const transaction = applyPlan(plan, approvals(plan));
  rollbackTransaction(root, transaction.id);
  assert.deepEqual(readFileSync(target), beforeBytes);
  assert.equal(statSync(target).mode & 0o777, beforeMode);
});

test("rollback preserves empty parent directories that existed before apply", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const parent = path.join(root, ".agents");
  mkdirSync(parent);
  const target = path.join(parent, "created.txt");
  const plan = finalizePlan({
    id: "plan-empty-parent",
    root,
    desiredState: {},
    snapshot: {
      git: {
        isRepo: true,
        head: "",
        branch: "main",
        statusHash: inspectProject(root).git.statusHash,
      },
    },
    recommendations: [],
    actions: [{
      id: "001-agents-write-file",
      module: "agents",
      type: "write-file",
      risk: "R1",
      target: ".agents/created.txt",
      content: "temporary\n",
      description: "Create a file inside a pre-existing empty directory.",
      precondition: filePrecondition(target),
    }],
  });
  const transaction = applyPlan(plan, approvals(plan));
  rollbackTransaction(root, transaction.id);
  assert.equal(existsSync(parent), true);
  assert.deepEqual(readdirSync(parent), []);
});

test("files containing secret material are never persisted as transaction backups", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const secret = "supersecretvalue";
  const target = path.join(root, "AGENTS.md");
  writeFileSync(target, `password=${secret}\n`);
  const { plan } = makePlan(root, "minimal");
  assert.throws(() => applyPlan(plan, approvals(plan)), /contains secret-like material/i);
  assert.equal(readFileSync(target, "utf8"), `password=${secret}\n`);

  const sentinelRoot = path.join(git(root, "rev-parse", "--absolute-git-dir"), "sentinel");
  const files = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  visit(sentinelRoot);
  assert.equal(files.some((file) => readFileSync(file).includes(Buffer.from(secret))), false);
});

test("greenfield apply and rollback return an empty directory", (t) => {
  const root = tempProject("sentinel-greenfield-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { plan } = makePlan(root, "minimal");
  assert.equal(plan.actions[0].type, "git-init");
  const transaction = applyPlan(plan, approvals(plan));
  assert.equal(existsSync(path.join(root, ".git")), true);
  rollbackTransaction(root, transaction.id);
  assert.deepEqual(readdirSync(root), []);
});

test("greenfield git initialization is journaled before it can be interrupted", (t) => {
  const root = tempProject("sentinel-greenfield-interrupt-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { plan } = makePlan(root, "minimal");
  assert.throws(
    () => applyPlan(plan, { ...approvals(plan), simulateInterruptionAfter: "git-init" }),
    /simulated interruption/i,
  );
  const interrupted = listTransactions(root).find((item) => item.status === "applying");
  assert.ok(interrupted);
  const resumed = resumeTransaction(root, interrupted.id);
  assert.equal(resumed.status, "completed");
  rollbackTransaction(root, interrupted.id);
  assert.deepEqual(readdirSync(root), []);
});

test("invalid desired and legacy JSON are preserved exactly", (t) => {
  const desiredRoot = tempProject();
  const legacyRoot = tempProject();
  t.after(() => rmSync(desiredRoot, { recursive: true, force: true }));
  t.after(() => rmSync(legacyRoot, { recursive: true, force: true }));
  git(desiredRoot, "init", "-b", "main");
  git(legacyRoot, "init", "-b", "main");

  const desiredBytes = "{ invalid desired json\r\n";
  writeFileSync(path.join(desiredRoot, "sentinel.config.json"), desiredBytes);
  assert.throws(() => makePlan(desiredRoot), /Invalid sentinel\.config\.json/);
  assert.equal(readFileSync(path.join(desiredRoot, "sentinel.config.json"), "utf8"), desiredBytes);

  const legacyBytes = "{ invalid legacy json\r\n";
  writeFileSync(path.join(legacyRoot, ".gitflow-sentinel.json"), legacyBytes);
  assert.throws(() => makePlan(legacyRoot), /invalid .*json/i);
  assert.equal(readFileSync(path.join(legacyRoot, ".gitflow-sentinel.json"), "utf8"), legacyBytes);
  assert.equal(existsSync(path.join(legacyRoot, "sentinel.config.json")), false);
});

test("R3 actions require their own approval and roll back prior local work", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const target = path.join(root, "local.txt");
  const plan = finalizePlan({
    id: "plan-r3-test",
    root,
    desiredState: { project: { description: "" } },
    snapshot: {},
    recommendations: [],
    actions: [
      {
        id: "001-docs-write-file",
        module: "docs",
        type: "write-file",
        risk: "R1",
        target: "local.txt",
        content: "temporary\n",
        description: "Create a local file.",
        precondition: filePrecondition(target),
      },
      {
        id: "002-github-github-create",
        module: "github",
        type: "github-create",
        risk: "R3",
        owner: "",
        name: "never-created",
        visibility: "private",
        description: "Create a remote repository.",
      },
    ],
  });

  assert.throws(
    () => applyPlan(plan, approvals(plan)),
    /needs --approve-r3 002-github-github-create/,
  );
  assert.equal(existsSync(target), false);
});

test("approved remote branch creation crosses the native hook with a scoped override", (t) => {
  const root = tempProject("sentinel-approved-push-");
  const remote = tempProject("sentinel-approved-push-remote-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(remote, { recursive: true, force: true }));

  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "sentinel@example.invalid");
  git(root, "config", "user.name", "Sentinel Test");
  writeFileSync(path.join(root, "seed.txt"), "seed\n");
  git(root, "add", "seed.txt");
  git(root, "commit", "-m", "test: seed project");
  git(root, "branch", "dev");
  git(remote, "init", "--bare");
  git(root, "remote", "add", "origin", remote);

  const hooks = path.join(root, ".test-hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(
    path.join(hooks, "pre-push"),
    "#!/bin/sh\n[ \"$GITFLOW_OVERRIDE\" = \"explicit\" ] || exit 1\n",
    { mode: 0o755 },
  );
  git(root, "config", "core.hooksPath", ".test-hooks");
  assert.throws(() => git(root, "push", "origin", "dev:dev"));

  const tip = git(root, "rev-parse", "dev");
  const actionId = "001-github-github-push-branch";
  const plan = finalizePlan({
    id: "plan-approved-push-test",
    root,
    desiredState: {},
    snapshot: {},
    recommendations: [],
    actions: [{
      id: actionId,
      module: "github",
      type: "github-push-branch",
      risk: "R3",
      branchName: "dev",
      expectedTip: tip,
      description: "Create the approved integration branch.",
    }],
  });

  const transaction = applyPlan(plan, approvals(plan, { r3Approvals: [actionId] }));
  assert.equal(transaction.status, "completed");
  assert.equal(git(remote, "rev-parse", "refs/heads/dev"), tip);
  assert.equal(git(root, "rev-parse", "--abbrev-ref", "dev@{upstream}"), "origin/dev");
});

test("transaction paths cannot escape the project root", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
  t.after(() => rmSync(outside, { force: true }));
  const plan = finalizePlan({
    id: "plan-path-test",
    root,
    desiredState: {},
    snapshot: {},
    recommendations: [],
    actions: [{
      id: "001-docs-write-file",
      module: "docs",
      type: "write-file",
      risk: "R1",
      target: `../${path.basename(outside)}`,
      content: "escape\n",
      description: "Attempt a path escape.",
      precondition: { exists: false, sha256: null },
    }],
  });

  assert.throws(() => applyPlan(plan, approvals(plan)), /unsafe plan target/i);
  assert.equal(existsSync(outside), false);
});

test("resume reconciles a write interrupted after the atomic rename", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const target = path.join(root, "resume.txt");
  const action = {
    id: "001-docs-write-file",
    module: "docs",
    type: "write-file",
    risk: "R1",
    target: "resume.txt",
    content: "resumed\n",
    description: "Create a resumable file.",
    precondition: filePrecondition(target),
  };
  const plan = finalizePlan({
    id: "plan-resume-test",
    root,
    desiredState: {},
    snapshot: {},
    recommendations: [],
    actions: [action],
  });
  const completed = applyPlan(plan, approvals(plan));
  const loaded = loadTransaction(root, completed.id);
  loaded.value.status = "applying";
  loaded.value.completed = [];
  loaded.value.inFlight = { actionId: action.id, startedAt: new Date().toISOString() };
  writeFileSync(loaded.file, `${JSON.stringify(loaded.value, null, 2)}\n`);

  const resumed = resumeTransaction(root, completed.id);
  assert.equal(resumed.status, "completed");
  assert.equal(readFileSync(target, "utf8"), "resumed\n");
  rollbackTransaction(root, completed.id);
  assert.equal(existsSync(target), false);
});

test("resume recovers interruptions after every local action family", async (t) => {
  const fixtures = [
    {
      type: "write-file",
      module: "docs",
      target: "created.txt",
      content: "created\n",
    },
    {
      type: "merge-managed-block",
      module: "docs",
      target: "existing.md",
      content: "managed",
      label: "fixture",
      existing: "preserved\n",
    },
    {
      type: "merge-json",
      module: "git",
      target: "settings.json",
      strategy: "deep",
      patch: { sentinel: true },
      existing: "{\"preserved\":true}\n",
    },
    {
      type: "git-config",
      module: "git",
      key: "sentinel.fixture",
      value: "enabled",
      precondition: { value: "" },
    },
    {
      type: "git-branch",
      module: "git",
      branchName: "dev",
      requiresCommit: true,
    },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.type, (subtest) => {
      const root = tempProject(`sentinel-interrupt-${fixture.type}-`);
      subtest.after(() => rmSync(root, { recursive: true, force: true }));
      git(root, "init", "-b", "main");
      if (fixture.requiresCommit) {
        git(root, "config", "user.email", "sentinel@example.invalid");
        git(root, "config", "user.name", "Sentinel Test");
        writeFileSync(path.join(root, "seed.txt"), "seed\n");
        git(root, "add", "seed.txt");
        git(root, "commit", "-m", "test: seed branch fixture");
      }
      if (fixture.target && fixture.existing !== undefined) writeFileSync(path.join(root, fixture.target), fixture.existing);
      const action = {
        id: `001-${fixture.module}-${fixture.type}`,
        module: fixture.module,
        type: fixture.type,
        risk: fixture.existing !== undefined ? "R2" : "R1",
        description: `Exercise ${fixture.type}.`,
        ...(fixture.target ? {
          target: fixture.target,
          precondition: filePrecondition(path.join(root, fixture.target)),
        } : {}),
        ...(fixture.content !== undefined ? { content: fixture.content } : {}),
        ...(fixture.label ? { label: fixture.label } : {}),
        ...(fixture.strategy ? { strategy: fixture.strategy } : {}),
        ...(fixture.patch ? { patch: fixture.patch } : {}),
        ...(fixture.key ? { key: fixture.key, value: fixture.value, precondition: fixture.precondition } : {}),
        ...(fixture.branchName ? {
          branchName: fixture.branchName,
          startPoint: git(root, "rev-parse", "HEAD"),
          precondition: { exists: false, startPoint: git(root, "rev-parse", "HEAD") },
        } : {}),
      };
      const plan = finalizePlan({
        id: `plan-interrupt-${fixture.type}`,
        root,
        desiredState: {},
        snapshot: {
          git: {
            isRepo: true,
            head: fixture.requiresCommit ? git(root, "rev-parse", "HEAD") : "",
            branch: "main",
            statusHash: inspectProject(root).git.statusHash,
          },
        },
        recommendations: [],
        actions: [action],
      });
      assert.throws(
        () => applyPlan(plan, { ...approvals(plan), simulateInterruptionAfter: fixture.type }),
        /simulated interruption/i,
      );
      const interrupted = listTransactions(root).find((item) => item.status === "applying");
      assert.ok(interrupted);
      const resumed = resumeTransaction(root, interrupted.id);
      assert.equal(resumed.status, "completed");
      rollbackTransaction(root, interrupted.id);
      if (fixture.target && fixture.existing !== undefined) {
        assert.equal(readFileSync(path.join(root, fixture.target), "utf8"), fixture.existing);
      } else if (fixture.target) {
        assert.equal(existsSync(path.join(root, fixture.target)), false);
      } else if (fixture.key) {
        assert.throws(() => git(root, "config", "--local", "--get", fixture.key));
      } else if (fixture.branchName) {
        assert.throws(() => git(root, "rev-parse", "--verify", fixture.branchName));
      }
    });
  }
});

test("core uninstall previews a hash and restores owned local changes", (t) => {
  const root = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const { plan } = makePlan(root, "minimal");
  applyPlan(plan, approvals(plan));
  const cli = path.resolve("scripts/cli.mjs");
  const preview = JSON.parse(execFileSync(
    process.execPath,
    [cli, "uninstall", root, "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ));
  assert.equal(preview.transactions.length, 1);
  execFileSync(
    process.execPath,
    [cli, "uninstall", root, "--approve", preview.hash],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.equal(existsSync(path.join(root, "sentinel.config.json")), false);
  assert.throws(() => git(root, "config", "--local", "--get", "core.hooksPath"));
});

test("monorepos and project paths containing spaces remain transactional", (t) => {
  const parent = tempProject();
  const root = path.join(parent, "project with spaces");
  mkdirSync(root);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    name: "workspace-fixture",
    workspaces: ["packages/*"],
  }, null, 2)}\n`);
  const snapshot = inspectProject(root);
  assert.equal(snapshot.technology.monorepo, true);
  const loaded = loadDesiredState(root, snapshot, { profile: "minimal" });
  const plan = buildPlan(root, snapshot, loaded.config, loaded);
  const transaction = applyPlan(plan, approvals(plan));
  assert.equal(transaction.status, "completed");
  rollbackTransaction(root, transaction.id);
  assert.deepEqual(readdirSync(root).sort(), [".git", "package.json"]);
});

test("symbolic-link write targets are rejected when the platform supports links", (t) => {
  const root = tempProject();
  const external = tempProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  const link = path.join(root, "linked");
  try {
    symlinkSync(external, link, "dir");
  } catch {
    t.skip("Symbolic links are unavailable for this test account.");
    return;
  }
  const target = path.join(link, "blocked.txt");
  const plan = finalizePlan({
    id: "plan-symlink-test",
    root,
    desiredState: {},
    snapshot: {},
    recommendations: [],
    actions: [{
      id: "001-docs-write-file",
      module: "docs",
      type: "write-file",
      risk: "R1",
      target: "linked/blocked.txt",
      content: "blocked\n",
      description: "Attempt to cross a symbolic link.",
      precondition: filePrecondition(target),
    }],
  });
  assert.throws(() => applyPlan(plan, approvals(plan)), /symbolic-link target is not allowed/i);
  assert.equal(existsSync(path.join(external, "blocked.txt")), false);
});
