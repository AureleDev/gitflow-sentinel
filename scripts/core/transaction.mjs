import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { run, isFailure, SKILL_ROOT } from "../lib.mjs";
import { assertPlan, createId, directoryHash, hashFile, sha256, stableJson, TRANSACTION_KIND, CONTRACT_VERSION } from "./contracts.mjs";
import { serializeMergedJson } from "./json-merge.mjs";
import { inspectGitHubProvider, rulesetMatches } from "./providers/github.mjs";
import { assertBackupSafe } from "./security.mjs";
import { getModule } from "./modules/registry.mjs";
import { mergeManagedBlock } from "./managed-block.mjs";
import { gitWorktreeHash } from "./worktree-state.mjs";

function gitDir(root) {
  const value = run("git", ["-C", root, "rev-parse", "--absolute-git-dir"], root);
  if (isFailure(value)) return "";
  return path.resolve(String(value).trim());
}

function storeRoot(root) {
  const dir = gitDir(root);
  if (!dir) throw new Error("A Git repository is required before transaction state can be stored.");
  return path.join(dir, "sentinel");
}

function atomicWrite(file, data, { mode } = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  writeFileSync(temp, data);
  if (mode !== undefined) {
    try { chmodSync(temp, mode); } catch { /* POSIX modes are advisory on Windows. */ }
  }
  renameSync(temp, file);
}

function writeJournal(file, transaction) {
  transaction.updatedAt = new Date().toISOString();
  atomicWrite(file, `${JSON.stringify(transaction, null, 2)}\n`, { mode: 0o600 });
}

function bootstrapJournal(root, id) {
  return path.join(path.resolve(root), `.gitflow-sentinel-bootstrap-${id}.json`);
}

function isBootstrapJournal(file) {
  return /^\.gitflow-sentinel-bootstrap-.+\.json$/.test(path.basename(file));
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireTransactionLock(root) {
  const existingGitDir = gitDir(root);
  const directory = existingGitDir ? path.join(existingGitDir, "sentinel") : path.resolve(root);
  const file = existingGitDir
    ? path.join(directory, "transaction.lock")
    : path.join(directory, ".gitflow-sentinel.apply.lock");
  mkdirSync(directory, { recursive: true });

  function create() {
    const descriptor = openSync(file, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        root: path.resolve(root),
      })}\n`);
    } finally {
      closeSync(descriptor);
    }
  }

  try {
    create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let owner = null;
    try { owner = JSON.parse(readFileSync(file, "utf8")); } catch { /* Report an unreadable lock below. */ }
    if (owner && !processIsAlive(Number(owner.pid))) {
      rmSync(file, { force: true });
      create();
    } else {
      const detail = owner?.pid ? ` by process ${owner.pid}` : "";
      throw new Error(`Another Sentinel transaction is active${detail}. Lock: ${file}`);
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    rmSync(file, { force: true });
  };
}

function safeTarget(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) throw new Error(`Unsafe target path: ${relative}`);
  const target = path.resolve(root, relative);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!target.startsWith(prefix) || target === path.resolve(root)) throw new Error(`Target escapes project root: ${relative}`);
  const rel = path.relative(root, target).replaceAll("\\", "/");
  if (rel === ".git" || rel.startsWith(".git/")) throw new Error(`Plans may not write Git internals directly: ${relative}`);

  let cursor = path.resolve(root);
  for (const part of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`Symbolic-link target is not allowed: ${relative}`);
  }
  return target;
}

function assertFilePrecondition(target, expected) {
  const exists = existsSync(target);
  const hash = hashFile(target);
  if (exists !== expected.exists || hash !== expected.sha256) {
    throw new Error(`Plan is stale for ${target}; expected ${expected.sha256 || "<missing>"}, found ${hash || "<missing>"}.`);
  }
}

function assertProjectPrecondition(plan, planFile) {
  const expected = plan.snapshot?.git;
  if (!expected?.isRepo) {
    const exclude = planFile ? [planFile] : [];
    const current = directoryHash(plan.root, { exclude });
    if (plan.snapshot?.project?.workspaceHash && current !== plan.snapshot.project.workspaceHash) {
      throw new Error("Plan is stale: the project folder changed after inspection.");
    }
    return;
  }
  const head = run("git", ["-C", plan.root, "rev-parse", "HEAD"], plan.root);
  const branch = run("git", ["-C", plan.root, "branch", "--show-current"], plan.root);
  if (isFailure(branch) || (isFailure(head) && expected.head)) throw new Error("Plan is stale: the Git repository is no longer readable.");
  const currentHead = isFailure(head) ? "" : String(head).trim();
  if (currentHead !== expected.head || String(branch).trim() !== expected.branch) {
    throw new Error("Plan is stale: the current commit or branch changed after inspection.");
  }
  const exclude = planFile ? [planFile] : [];
  if (expected.statusHash && gitWorktreeHash(plan.root, { exclude }) !== expected.statusHash) {
    throw new Error("Plan is stale: the working tree changed after inspection.");
  }
}

function removeEmptyParents(root, file) {
  let current = path.dirname(file);
  const boundary = path.resolve(root);
  while (current.startsWith(`${boundary}${path.sep}`) && current !== boundary) {
    if (path.basename(current) === ".git" || readdirSync(current).length) break;
    rmdirSync(current);
    current = path.dirname(current);
  }
}

function missingParentDirectories(root, file) {
  const missing = [];
  const boundary = path.resolve(root);
  let current = path.dirname(file);
  while (current.startsWith(`${boundary}${path.sep}`) && current !== boundary && !existsSync(current)) {
    missing.push(path.relative(root, current).replaceAll("\\", "/"));
    current = path.dirname(current);
  }
  return missing;
}

function removeRecordedParents(root, file, createdDirectories) {
  if (!Array.isArray(createdDirectories)) {
    removeEmptyParents(root, file);
    return;
  }
  for (const relative of createdDirectories) {
    const directory = safeTarget(root, relative);
    if (existsSync(directory) && lstatSync(directory).isDirectory() && readdirSync(directory).length === 0) {
      rmdirSync(directory);
    }
  }
}

function backupFile(transaction, journalFile, action, target) {
  const backupDir = path.join(path.dirname(path.dirname(journalFile)), "backups", transaction.id);
  mkdirSync(backupDir, { recursive: true });
  const existed = existsSync(target);
  const backup = path.join(backupDir, `${action.id}.bak`);
  const createdDirectories = existed ? [] : missingParentDirectories(transaction.plan.root, target);
  let metadata = null;
  if (existed) {
    const value = readFileSync(target);
    assertBackupSafe(action.target, value);
    const stat = statSync(target);
    metadata = {
      mode: stat.mode & 0o777,
      atimeMs: stat.atimeMs,
      mtimeMs: stat.mtimeMs,
    };
    writeFileSync(backup, value, { mode: 0o600 });
    try { chmodSync(backup, 0o600); } catch { /* POSIX modes are advisory on Windows. */ }
  }
  return { existed, backup: existed ? backup : "", beforeHash: hashFile(target), metadata, createdDirectories };
}

function nextFileContent(existing, action) {
  if (action.type === "merge-managed-block") {
    return mergeManagedBlock(existing, action.content, action.label, action.target);
  }
  if (action.type === "merge-json") {
    let parsed;
    try {
      parsed = existing ? JSON.parse(existing) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("root value must be an object");
    } catch (error) {
      throw new Error(`${action.target} became invalid JSON: ${error.message}`);
    }
    return serializeMergedJson(parsed, action);
  }
  return action.content;
}

function applyFileAction(transaction, journalFile, action) {
  const root = transaction.plan.root;
  const target = safeTarget(root, action.target);
  assertFilePrecondition(target, action.precondition);
  const prior = backupFile(transaction, journalFile, action, target);
  transaction.inFlight.prior = prior;
  writeJournal(journalFile, transaction);
  const existing = prior.existed ? readFileSync(target, "utf8") : "";
  const next = nextFileContent(existing, action);
  mkdirSync(path.dirname(target), { recursive: true });
  atomicWrite(target, next, { mode: prior.metadata?.mode });
  if (/^\.gitflow-sentinel\/githooks\/(pre-commit|commit-msg|pre-push|native\.mjs)$/.test(action.target)) {
    try { chmodSync(target, 0o755); } catch { /* Windows does not expose POSIX modes. */ }
  }
  return {
    kind: "file",
    target: action.target,
    ...prior,
    afterHash: hashFile(target),
    reversible: true,
  };
}

function gitConfigValue(root, key) {
  const value = run("git", ["-C", root, "config", "--local", "--get", key], root);
  return isFailure(value) ? "" : String(value).trim();
}

function applyGitConfig(transaction, action) {
  const root = transaction.plan.root;
  const current = gitConfigValue(root, action.key);
  if (current !== action.precondition.value) {
    throw new Error(`Plan is stale for Git config ${action.key}; expected '${action.precondition.value}', found '${current}'.`);
  }
  const result = run("git", ["-C", root, "config", "--local", action.key, action.value], root);
  if (isFailure(result)) throw new Error(`Could not set Git config ${action.key}: ${result.message}`);
  return { kind: "git-config", key: action.key, before: current, after: action.value, reversible: true };
}

function applyGitInit(transaction, action) {
  const root = transaction.plan.root;
  const current = run("git", ["-C", root, "rev-parse", "--show-toplevel"], root);
  if (!isFailure(current)) throw new Error("Git repository appeared after the plan was created.");
  const result = run("git", ["init", "-b", action.initialBranch], root);
  if (isFailure(result)) throw new Error(`git init failed: ${result.message}`);
  return { kind: "git-init", gitDir: gitDir(root), reversible: true };
}

function gitBranchTip(root, branch) {
  const value = run("git", ["-C", root, "rev-parse", "--verify", `refs/heads/${branch}`], root);
  return isFailure(value) ? "" : String(value).trim();
}

function applyGitBranch(transaction, action) {
  const root = transaction.plan.root;
  const valid = run("git", ["check-ref-format", "--branch", action.branchName], root);
  if (isFailure(valid)) throw new Error(`Invalid Git branch name: ${action.branchName}.`);
  if (gitBranchTip(root, action.branchName)) throw new Error(`Plan is stale: branch ${action.branchName} already exists.`);
  const startPoint = run("git", ["-C", root, "rev-parse", "--verify", action.startPoint], root);
  if (isFailure(startPoint) || String(startPoint).trim() !== action.precondition.startPoint) {
    throw new Error(`Plan is stale: start point for ${action.branchName} changed.`);
  }
  const result = run("git", ["-C", root, "branch", action.branchName, action.startPoint], root);
  if (isFailure(result)) throw new Error(`Could not create Git branch ${action.branchName}: ${result.message}`);
  return {
    kind: "git-branch",
    branchName: action.branchName,
    createdTip: gitBranchTip(root, action.branchName),
    reversible: true,
  };
}

function applyGitHubCreate(transaction, action) {
  const root = transaction.plan.root;
  const currentRemote = run("git", ["-C", root, "remote", "get-url", "origin"], root);
  if (!isFailure(currentRemote)) throw new Error("origin already exists; refusing to create another GitHub repository.");
  const slug = action.owner ? `${action.owner}/${action.name}` : action.name;
  const result = run(
    "gh",
    ["repo", "create", slug, `--${action.visibility}`, "--source", root, "--remote", "origin", "--description", transaction.plan.desiredState.project.description || ""],
    root,
    { timeout: 60_000 },
  );
  if (isFailure(result)) throw new Error(`GitHub repository creation failed: ${result.message}`);
  return { kind: "github-create", slug, reversible: false };
}

function remoteBranchTip(root, branch) {
  const value = run("git", ["-C", root, "ls-remote", "--heads", "origin", branch], root, { timeout: 30_000 });
  if (isFailure(value)) return "";
  return String(value).trim().split(/\s+/)[0] || "";
}

function applyGitHubPushBranch(transaction, action) {
  const root = transaction.plan.root;
  if (remoteBranchTip(root, action.branchName)) throw new Error(`Plan is stale: origin/${action.branchName} already exists.`);
  const localTip = gitBranchTip(root, action.branchName);
  if (!localTip) throw new Error(`Local branch ${action.branchName} does not exist.`);
  if (action.expectedTip && localTip !== action.expectedTip) {
    throw new Error(`Plan is stale: local branch ${action.branchName} changed before push.`);
  }
  const result = run(
    "git",
    ["-C", root, "push", "--set-upstream", "origin", `${action.branchName}:${action.branchName}`],
    root,
    {
      timeout: 60_000,
      // The native hook must keep blocking ordinary direct pushes to protected
      // branches. This exception is limited to the already approved, journaled
      // R3 action that creates the integration branch and is verified below.
      env: { GITFLOW_OVERRIDE: "explicit" },
    },
  );
  if (isFailure(result)) throw new Error(`Could not push ${action.branchName}: ${result.message}`);
  const remoteTip = remoteBranchTip(root, action.branchName);
  if (remoteTip !== localTip) throw new Error(`Push verification failed for origin/${action.branchName}.`);
  return { kind: "github-push-branch", branchName: action.branchName, tip: remoteTip, reversible: false };
}

function applyGitHubDefaultBranch(transaction, action) {
  const root = transaction.plan.root;
  const remote = run("git", ["-C", root, "remote", "get-url", "origin"], root);
  if (isFailure(remote)) throw new Error("Plan is stale: the GitHub origin is no longer available.");
  const current = inspectGitHubProvider(root, String(remote));
  if (current.slug !== action.precondition.slug || current.defaultBranch !== action.precondition.defaultBranch) {
    throw new Error("Plan is stale: GitHub default-branch state changed after inspection.");
  }
  if (!current.remoteBranches.includes(action.branchName)) {
    throw new Error(`GitHub branch ${action.branchName} does not exist; refusing to set it as default.`);
  }
  const result = run("gh", ["repo", "edit", current.slug, "--default-branch", action.branchName], root, { timeout: 30_000 });
  if (isFailure(result)) throw new Error(`Could not set GitHub default branch: ${result.message}`);
  const verified = inspectGitHubProvider(root, String(remote));
  if (verified.defaultBranch !== action.branchName) throw new Error("GitHub default-branch verification failed.");
  return { kind: "github-default-branch", branchName: action.branchName, reversible: false };
}

function applyGitHubRuleset(transaction, action) {
  const remote = run("git", ["-C", transaction.plan.root, "remote", "get-url", "origin"], transaction.plan.root);
  if (isFailure(remote)) throw new Error("Plan is stale: the GitHub origin is no longer available.");
  const current = inspectGitHubProvider(transaction.plan.root, String(remote));
  const actual = {
    slug: current.slug,
    visibility: current.visibility,
    ruleset: current.ruleset,
  };
  if (stableJson(actual) !== stableJson(action.precondition)) {
    throw new Error("Plan is stale: GitHub state changed after inspection.");
  }
  const result = run(
    process.execPath,
    [
      path.join(SKILL_ROOT, "scripts", "github-protect.mjs"),
      "--project-root", transaction.plan.root,
      "--reviewers", String(action.reviewers),
      "--apply",
    ],
    transaction.plan.root,
    { timeout: 60_000 },
  );
  if (isFailure(result)) throw new Error(`GitHub ruleset failed: ${result.message}`);
  return { kind: "github-ruleset", reversible: false };
}

function applyAction(transaction, journalFile, action) {
  return getModule(action.module).apply({
    action,
    handlers: {
      "write-file": (value) => applyFileAction(transaction, journalFile, value),
      "merge-managed-block": (value) => applyFileAction(transaction, journalFile, value),
      "merge-json": (value) => applyFileAction(transaction, journalFile, value),
      "git-init": (value) => applyGitInit(transaction, value),
      "git-config": (value) => applyGitConfig(transaction, value),
      "git-branch": (value) => applyGitBranch(transaction, value),
      "github-create": (value) => applyGitHubCreate(transaction, value),
      "github-push-branch": (value) => applyGitHubPushBranch(transaction, value),
      "github-default-branch": (value) => applyGitHubDefaultBranch(transaction, value),
      "github-ruleset": (value) => applyGitHubRuleset(transaction, value),
    },
  });
}

function rollbackRecord(root, record) {
  if (record.kind === "file") {
    const target = safeTarget(root, record.target);
    if (hashFile(target) !== record.afterHash) {
      throw new Error(`Cannot restore ${record.target}: it changed after Sentinel wrote it.`);
    }
    if (record.existed) {
      atomicWrite(target, readFileSync(record.backup), { mode: record.metadata?.mode });
      if (record.metadata?.atimeMs !== undefined && record.metadata?.mtimeMs !== undefined) {
        try { utimesSync(target, new Date(record.metadata.atimeMs), new Date(record.metadata.mtimeMs)); } catch { /* Best effort on limited filesystems. */ }
      }
    }
    else {
      rmSync(target, { force: true });
      removeRecordedParents(root, target, record.createdDirectories);
    }
    return { restored: true };
  }
  if (record.kind === "git-init") {
    const dir = path.resolve(record.gitDir || "");
    const expected = path.resolve(root, ".git");
    const sameDirectory = existsSync(dir) && existsSync(expected) &&
      realpathSync.native(dir).toLowerCase() === realpathSync.native(expected).toLowerCase();
    const head = run("git", ["-C", root, "rev-parse", "HEAD"], root);
    const remotes = run("git", ["-C", root, "remote"], root);
    if (!sameDirectory || !isFailure(head) || (!isFailure(remotes) && String(remotes).trim())) {
      throw new Error("Git initialization cannot be rolled back because the repository now has commits, remotes, or a nonstandard Git directory.");
    }
    rmSync(dir, { recursive: true, force: true });
    return { restored: true };
  }
  if (record.kind === "git-config") {
    const current = gitConfigValue(root, record.key);
    if (current !== record.after) throw new Error(`Cannot restore Git config ${record.key}: it changed after Sentinel wrote it.`);
    const args = record.before
      ? ["-C", root, "config", "--local", record.key, record.before]
      : ["-C", root, "config", "--local", "--unset", record.key];
    const result = run("git", args, root);
    if (isFailure(result) && record.before) throw new Error(`Could not restore Git config ${record.key}: ${result.message}`);
    return { restored: true };
  }
  if (record.kind === "git-branch") {
    const currentBranch = run("git", ["-C", root, "branch", "--show-current"], root);
    if (!isFailure(currentBranch) && String(currentBranch).trim() === record.branchName) {
      throw new Error(`Cannot remove ${record.branchName}: it is currently checked out.`);
    }
    const tip = gitBranchTip(root, record.branchName);
    if (!tip) return { restored: true };
    if (tip !== record.createdTip) throw new Error(`Cannot remove ${record.branchName}: it changed after Sentinel created it.`);
    const removed = run("git", ["-C", root, "branch", "-D", record.branchName], root);
    if (isFailure(removed)) throw new Error(`Could not remove Git branch ${record.branchName}: ${removed.message}`);
    return { restored: true };
  }
  return { restored: false, reason: "external action requires a separately approved compensating plan" };
}

function rollbackCompleted(transaction, journalFile) {
  const errors = [];
  for (const completed of [...transaction.completed].reverse()) {
    try {
      const action = transaction.plan.actions.find((item) => item.id === completed.actionId);
      const result = action
        ? getModule(action.module).rollback({
          record: completed.result,
          handler: (record) => rollbackRecord(transaction.plan.root, record),
        })
        : rollbackRecord(transaction.plan.root, completed.result);
      completed.rollback = result;
      if (!result.restored) errors.push(`${completed.actionId}: ${result.reason || "not restored"}`);
    } catch (error) {
      completed.rollback = { restored: false, reason: error.message };
      errors.push(error.message);
    }
    if (existsSync(journalFile)) writeJournal(journalFile, transaction);
  }
  transaction.completed = transaction.completed.filter((entry) => entry.rollback?.restored !== true);
  return errors;
}

function reconcileInFlight(transaction, journalFile, r3Resolutions = new Map()) {
  if (!transaction.inFlight) return;
  const action = transaction.plan.actions.find((item) => item.id === transaction.inFlight.actionId);
  if (!action) throw new Error(`In-flight action ${transaction.inFlight.actionId} is not in the approved plan.`);
  const root = transaction.plan.root;

  if (["write-file", "merge-managed-block", "merge-json"].includes(action.type)) {
    const target = safeTarget(root, action.target);
    const current = hashFile(target);
    if (current !== action.precondition.sha256 || existsSync(target) !== action.precondition.exists) {
      const backup = path.join(path.dirname(path.dirname(journalFile)), "backups", transaction.id, `${action.id}.bak`);
      if (action.precondition.exists && !existsSync(backup)) {
        throw new Error(`Cannot reconcile ${action.id}: its write began but the backup is missing.`);
      }
      const before = action.precondition.exists ? readFileSync(backup, "utf8") : "";
      const expectedAfter = sha256(nextFileContent(before, action));
      if (current !== expectedAfter) {
        throw new Error(`Cannot reconcile ${action.id}: the target changed after the interrupted write.`);
      }
      if (action.precondition.exists) {
        const metadata = transaction.inFlight.prior?.metadata;
        atomicWrite(target, readFileSync(backup), { mode: metadata?.mode });
        if (metadata?.atimeMs !== undefined && metadata?.mtimeMs !== undefined) {
          try { utimesSync(target, new Date(metadata.atimeMs), new Date(metadata.mtimeMs)); } catch { /* Best effort on limited filesystems. */ }
        }
      }
      else {
        rmSync(target, { force: true });
        removeRecordedParents(root, target, transaction.inFlight.prior?.createdDirectories);
      }
    }
  } else if (action.type === "git-config") {
    const current = gitConfigValue(root, action.key);
    if (current === action.value) {
      const args = action.precondition.value
        ? ["-C", root, "config", "--local", action.key, action.precondition.value]
        : ["-C", root, "config", "--local", "--unset", action.key];
      const restored = run("git", args, root);
      if (isFailure(restored) && action.precondition.value) throw new Error(`Could not reconcile Git config ${action.key}.`);
    } else if (current !== action.precondition.value) {
      throw new Error(`Cannot reconcile Git config ${action.key}: it changed after interruption.`);
    }
  } else if (action.type === "git-init") {
    const dir = gitDir(root);
    if (dir) rollbackRecord(root, { kind: "git-init", gitDir: dir });
  } else if (action.type === "git-branch") {
    const tip = gitBranchTip(root, action.branchName);
    if (tip && tip !== action.precondition.startPoint) {
      throw new Error(`Cannot reconcile ${action.id}: branch ${action.branchName} changed after creation.`);
    }
    if (tip) {
      const removed = run("git", ["-C", root, "branch", "-D", action.branchName], root);
      if (isFailure(removed)) throw new Error(`Could not reconcile Git branch ${action.branchName}.`);
    }
  } else {
    const resolution = r3Resolutions.get(action.id);
    if (!["retry", "accept"].includes(resolution)) {
      throw new Error(`External action ${action.id} was interrupted; resume requires --resolve-r3 ${action.id}:retry|accept after checking GitHub.`);
    }
    if (resolution === "accept") {
      const remote = run("git", ["-C", root, "remote", "get-url", "origin"], root);
      if (isFailure(remote)) throw new Error(`Cannot accept ${action.id}: origin is not configured.`);
      const current = inspectGitHubProvider(root, String(remote));
      if (action.type === "github-create") {
        const expectedSlug = action.owner ? `${action.owner}/${action.name}` : action.name;
        if (!current.connected || (!current.slug.endsWith(`/${action.name}`) && current.slug !== expectedSlug)) {
          throw new Error(`Cannot accept ${action.id}: the expected GitHub repository was not verified.`);
        }
      } else if (action.type === "github-push-branch") {
        if (remoteBranchTip(root, action.branchName) !== action.expectedTip && action.expectedTip) {
          throw new Error(`Cannot accept ${action.id}: origin/${action.branchName} does not match the approved tip.`);
        }
        if (!remoteBranchTip(root, action.branchName)) {
          throw new Error(`Cannot accept ${action.id}: origin/${action.branchName} was not verified.`);
        }
      } else if (action.type === "github-default-branch") {
        if (current.defaultBranch !== action.branchName) {
          throw new Error(`Cannot accept ${action.id}: GitHub default branch is not ${action.branchName}.`);
        }
      } else {
        const available = new Set(current.remoteBranches);
        const branches = transaction.plan.desiredState.vcs.protectedBranches.filter((branch) => available.has(branch));
        if (!rulesetMatches(current.ruleset, branches, action.reviewers)) {
          throw new Error(`Cannot accept ${action.id}: the expected GitHub ruleset was not verified.`);
        }
      }
      transaction.completed.push({
        actionId: action.id,
        completedAt: new Date().toISOString(),
        result: { kind: action.type, reversible: false, reconciled: true },
      });
    }
  }

  delete transaction.inFlight;
  writeJournal(journalFile, transaction);
}

function runTransaction(transaction, journalFile, r3Approvals, { simulateInterruptionAfter = "" } = {}) {
  transaction.approvals = transaction.approvals || { planHash: transaction.plan.hash, r2: [], r3: [] };
  transaction.approvals.r3 = [...new Set([...(transaction.approvals.r3 || []), ...r3Approvals])].sort();
  transaction.status = "applying";
  writeJournal(journalFile, transaction);
  try {
    for (const action of transaction.plan.actions) {
      if (transaction.completed.some((entry) => entry.actionId === action.id)) continue;
      if (action.risk === "R3" && !r3Approvals.has(action.id)) {
        throw new Error(`R3 action ${action.id} needs --approve-r3 ${action.id}.`);
      }
      transaction.inFlight = { actionId: action.id, startedAt: new Date().toISOString() };
      writeJournal(journalFile, transaction);
      const result = applyAction(transaction, journalFile, action);
      if (action.type === "git-init" && isBootstrapJournal(journalFile)) {
        const previousJournal = journalFile;
        const migratedJournal = path.join(storeRoot(transaction.plan.root), "transactions", `${transaction.id}.json`);
        writeJournal(migratedJournal, transaction);
        journalFile = migratedJournal;
        rmSync(previousJournal, { force: true });
      }
      if (simulateInterruptionAfter === action.id || simulateInterruptionAfter === action.type) {
        const interruption = new Error(`Simulated interruption after ${action.id}.`);
        interruption.code = "SENTINEL_SIMULATED_INTERRUPTION";
        throw interruption;
      }
      transaction.completed.push({ actionId: action.id, completedAt: new Date().toISOString(), result });
      delete transaction.inFlight;
      writeJournal(journalFile, transaction);
    }
    transaction.status = "completed";
    transaction.completedAt = new Date().toISOString();
    writeJournal(journalFile, transaction);
    return transaction;
  } catch (error) {
    if (error?.code === "SENTINEL_SIMULATED_INTERRUPTION") {
      transaction.status = "applying";
      transaction.error = error.message;
      writeJournal(journalFile, transaction);
      throw error;
    }
    transaction.status = "failed";
    transaction.error = error.message;
    const rollbackErrors = [];
    try { reconcileInFlight(transaction, journalFile); } catch (reconcileError) { rollbackErrors.push(reconcileError.message); }
    rollbackErrors.push(...rollbackCompleted(transaction, journalFile));
    transaction.status = rollbackErrors.length || transaction.completed.length ? "partial-rollback" : "rolled-back";
    transaction.rollbackErrors = rollbackErrors;
    if (existsSync(journalFile)) writeJournal(journalFile, transaction);
    throw new Error(`${error.message}${rollbackErrors.length ? ` Rollback issues: ${rollbackErrors.join("; ")}` : " Local changes were rolled back."}`);
  }
}

export function applyPlan(plan, {
  approval,
  r2Approvals = [],
  r3Approvals = [],
  planFile = "",
  simulateInterruptionAfter = "",
} = {}) {
  assertPlan(plan);
  if (approval !== plan.hash) throw new Error("Approval hash does not match the immutable plan.");
  const approvedGroups = new Set(r2Approvals);
  for (const group of plan.approvalGroups) {
    const token = `${group.id}:${group.hash}`;
    if (!approvedGroups.has(token)) throw new Error(`R2 group ${group.id} needs --approve-r2 ${token}.`);
  }
  const root = path.resolve(plan.root);
  if (!existsSync(root)) throw new Error(`Project root no longer exists: ${root}`);
  assertProjectPrecondition(plan, planFile);
  const releaseLock = acquireTransactionLock(root);
  try {
    const first = plan.actions[0];
    const transaction = {
      kind: TRANSACTION_KIND,
      schemaVersion: CONTRACT_VERSION,
      id: createId("txn"),
      createdAt: new Date().toISOString(),
      status: "pending",
      plan,
      approvals: {
        planHash: plan.hash,
        r2: [...r2Approvals].sort(),
        r3: [...r3Approvals].sort(),
      },
      completed: [],
    };
    const journalFile = first?.type === "git-init"
      ? bootstrapJournal(root, transaction.id)
      : path.join(storeRoot(root), "transactions", `${transaction.id}.json`);
    return runTransaction(transaction, journalFile, new Set(r3Approvals), { simulateInterruptionAfter });
  } finally {
    releaseLock();
  }
}

export function loadTransaction(root, id) {
  let file = "";
  try {
    const stored = path.join(storeRoot(root), "transactions", `${id}.json`);
    if (existsSync(stored)) file = stored;
  } catch { /* A greenfield interruption may only have a bootstrap journal. */ }
  const bootstrap = bootstrapJournal(root, id);
  if (!file && existsSync(bootstrap)) file = bootstrap;
  if (!file) throw new Error(`Transaction not found: ${id}`);
  const value = JSON.parse(readFileSync(file, "utf8"));
  return { file, value };
}

export function rollbackTransaction(root, id) {
  const releaseLock = acquireTransactionLock(root);
  try {
    const { file, value } = loadTransaction(root, id);
    if (!["completed", "failed", "partial-rollback"].includes(value.status)) {
      throw new Error(`Transaction ${id} cannot be rolled back from status ${value.status}.`);
    }
    const errors = rollbackCompleted(value, file);
    value.status = errors.length || value.completed.length ? "partial-rollback" : "rolled-back";
    value.rollbackErrors = errors;
    if (existsSync(file)) writeJournal(file, value);
    if (errors.length || value.completed.length) {
      throw new Error(`Rollback incomplete: ${errors.join("; ") || "external actions require a separately approved compensating plan"}`);
    }
    return value;
  } finally {
    releaseLock();
  }
}

export function resumeTransaction(root, id, { r3Approvals = [], r3Resolutions = [] } = {}) {
  const releaseLock = acquireTransactionLock(root);
  try {
    const { file, value } = loadTransaction(root, id);
    if (!["applying", "failed", "partial-rollback", "rolled-back"].includes(value.status)) {
      throw new Error(`Transaction ${id} cannot be resumed from status ${value.status}.`);
    }
    const resolutions = new Map(r3Resolutions.map((token) => {
      const separator = token.lastIndexOf(":");
      if (separator <= 0) throw new Error(`Invalid R3 resolution: ${token}`);
      return [token.slice(0, separator), token.slice(separator + 1)];
    }));
    reconcileInFlight(value, file, resolutions);
    value.error = "";
    value.rollbackErrors = [];
    return runTransaction(value, file, new Set(r3Approvals));
  } finally {
    releaseLock();
  }
}

export function listTransactions(root) {
  const files = [];
  try {
    const directory = path.join(storeRoot(root), "transactions");
    if (existsSync(directory)) {
      files.push(...readdirSync(directory)
        .filter((name) => name.endsWith(".json"))
        .map((name) => path.join(directory, name)));
    }
  } catch { /* A greenfield interruption can still be listed below. */ }
  files.push(...readdirSync(root)
    .filter((name) => /^\.gitflow-sentinel-bootstrap-.+\.json$/.test(name))
    .map((name) => path.join(root, name)));
  const byId = new Map();
  for (const file of files) {
    const name = path.basename(file);
    let summary;
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      summary = { id: value.id, status: value.status, createdAt: value.createdAt, updatedAt: value.updatedAt, planId: value.plan?.id || "" };
    } catch {
      summary = {
        id: name.replace(/^\.gitflow-sentinel-bootstrap-/, "").replace(/\.json$/, ""),
        status: "invalid",
        createdAt: "",
        updatedAt: "",
        planId: "",
      };
    }
    if (!byId.has(summary.id) || !isBootstrapJournal(file)) byId.set(summary.id, summary);
  }
  return [...byId.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
