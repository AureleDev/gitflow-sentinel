import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  buildRulesetPayload,
  normalizeRuleset,
  rulesetMatches,
} from "../scripts/core/providers/github.mjs";
import { analyze } from "../assets/templates/runtime/.gitflow-sentinel/core/parser.mjs";
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

test("all registered modules expose the deterministic lifecycle contract", () => {
  assert.deepEqual(MODULE_ORDER, [
    "git",
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
  mkdirSync(path.join(root, "node_modules", "ignored"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", "ignored", "Cargo.toml"), "[package]\nname = \"ignored\"\n");
  mkdirSync(path.join(root, ".kiro", "skills", "ignored"), { recursive: true });
  writeFileSync(path.join(root, ".kiro", "skills", "ignored", "Cargo.toml"), "[package]\nname = \"ignored-agent-skill\"\n");

  const snapshot = inspectProject(root);
  assert.deepEqual(snapshot.technology.languages, ["javascript", "python", "typescript"]);
  assert.deepEqual(snapshot.technology.packageManagers, ["uv"]);
  assert.equal(snapshot.technology.monorepo, true);
  assert.equal(snapshot.technology.packages.length, 2);
  assert.equal(snapshot.technology.manifests.some((file) => file.includes("node_modules")), false);
  assert.equal(snapshot.technology.scan.truncated, false);
  assert.equal(snapshot.provider.github.checked, false);
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
  writeFileSync(path.join(root, "changed.txt"), "drift\n");
  const changed = inspectProject(root);
  assert.equal(validQualityEvidence(root, changed, [check.command])[check.command], null);

  const evidenceRoot = path.join(git(root, "rev-parse", "--absolute-git-dir"), "sentinel", "quality-evidence");
  const persisted = readdirSync(evidenceRoot)
    .map((name) => readFileSync(path.join(evidenceRoot, name), "utf8"))
    .join("\n");
  assert.equal(persisted.includes(secretOutput), false);
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
  assert.equal(readFileSync(path.join(root, ".gitignore"), "utf8").includes("gitflow-sentinel:start project-foundations"), true);

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
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.type, (subtest) => {
      const root = tempProject(`sentinel-interrupt-${fixture.type}-`);
      subtest.after(() => rmSync(root, { recursive: true, force: true }));
      git(root, "init", "-b", "main");
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
      };
      const plan = finalizePlan({
        id: `plan-interrupt-${fixture.type}`,
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
      } else {
        assert.throws(() => git(root, "config", "--local", "--get", fixture.key));
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
