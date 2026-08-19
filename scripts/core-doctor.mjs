#!/usr/bin/env node
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isFailure, nextValue, resolveProjectRoot, run, SKILL_ROOT } from "./lib.mjs";
import { loadDesiredState, modulesFor } from "./core/config.mjs";
import { inspectProject } from "./core/inspect-project.mjs";
import { listTransactions } from "./core/transaction.mjs";

function parseArgs(argv) {
  const args = { projectRoot: ".", json: false, remote: false, offline: false };
  let positional = false;
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--project-root") { args.projectRoot = nextValue(argv, i, value); i += 1; }
    else if (value === "--json") args.json = true;
    else if (value === "--remote") args.remote = true;
    else if (value === "--offline") args.offline = true;
    else if (value === "--help" || value === "-h") args.help = true;
    else if (!value.startsWith("-") && !positional) { args.projectRoot = value; positional = true; }
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (args.remote && args.offline) throw new Error("--remote and --offline cannot be used together.");
  if (args.offline) args.remote = false;
  args.projectRoot = resolveProjectRoot(args.projectRoot);
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: gitflow-sentinel doctor [path] [--remote|--offline] [--json]");
  } else {
    const checks = [];
    const add = (id, status, detail) => checks.push({ id, status, detail });
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    add("node", nodeMajor >= 18 ? "pass" : "error", `Node ${process.versions.node}; required >=18`);

    const gitVersion = run("git", ["--version"], args.projectRoot);
    add("git", isFailure(gitVersion) ? "error" : "pass", isFailure(gitVersion) ? "Git is unavailable." : String(gitVersion));

    try {
      accessSync(args.projectRoot, constants.R_OK | constants.W_OK);
      add("filesystem", "pass", "Project directory is readable and writable.");
    } catch {
      add("filesystem", "error", "Project directory is not readable and writable.");
    }

    const snapshot = inspectProject(args.projectRoot, { remote: args.remote });
    add("repository", "pass", snapshot.git.isRepo ? `Existing Git repository on ${snapshot.git.branch || "detached HEAD"}.` : "Greenfield folder; Git can be initialized by an approved plan.");
    if (snapshot.environment.platform === "win32") {
      add(
        "git-longpaths",
        snapshot.git.longPaths || !snapshot.git.isRepo ? "pass" : "warning",
        snapshot.git.longPaths
          ? "Git long-path support is enabled."
          : snapshot.git.isRepo
            ? "Git long-path support is disabled; deep project trees may fail to index until an approved plan enables repository-local core.longpaths."
            : "An approved greenfield plan will enable repository-local Git long-path support after initialization.",
      );
    }

    let desired = null;
    try {
      const loaded = loadDesiredState(args.projectRoot, snapshot);
      desired = loaded.config;
      add("configuration", "pass", loaded.source === "file" ? "sentinel.config.json is valid." : `Desired state can be generated from ${loaded.source}.`);
      if (loaded.config.github.manageRuleset && snapshot.provider.github.connected) {
        const permission = snapshot.provider.github.permissions.viewer || "";
        add(
          "github-permission",
          ["ADMIN", "MAINTAIN"].includes(permission) ? "pass" : "error",
          permission ? `GitHub viewer permission: ${permission}.` : "GitHub permission could not be read.",
        );
        add(
          "github-ruleset-read",
          snapshot.provider.github.ruleset.readable ? "pass" : "error",
          snapshot.provider.github.ruleset.readable
            ? "GitHub ruleset state is readable."
            : "GitHub ruleset state is not readable; Sentinel will not plan a ruleset mutation.",
        );
      }
    } catch (error) {
      add("configuration", "error", error.message);
    }

    if (desired && snapshot.git.isRepo) {
      const missingBranches = desired.vcs.protectedBranches.filter((branch) => !snapshot.git.branches.includes(branch));
      add(
        "protected-branches-local",
        missingBranches.length ? "error" : "pass",
        missingBranches.length
          ? `Missing required local branch(es): ${missingBranches.join(", ")}.`
          : `Required local branches exist: ${desired.vcs.protectedBranches.join(", ")}.`,
      );

      if (modulesFor(desired).includes("git-policy")) {
        const runtimeFiles = [
          ".gitflow-sentinel/hooks/guard.mjs",
          ".gitflow-sentinel/hooks/session-start.mjs",
          ".gitflow-sentinel/hooks/cycle-reminder.mjs",
          ".gitflow-sentinel/githooks/pre-commit",
          ".gitflow-sentinel/githooks/commit-msg",
          ".gitflow-sentinel/githooks/pre-push",
        ];
        const missingRuntime = runtimeFiles.filter((file) => !existsSync(path.join(args.projectRoot, file)));
        add(
          "git-policy-runtime",
          missingRuntime.length ? "error" : "pass",
          missingRuntime.length
            ? `Managed policy runtime is incomplete (${missingRuntime.length} missing file(s)).`
            : "Managed policy runtime is present.",
        );
        const expectedVersion = JSON.parse(readFileSync(path.join(SKILL_ROOT, "package.json"), "utf8")).version;
        const runtimeVersionFile = path.join(args.projectRoot, ".gitflow-sentinel/VERSION");
        const runtimeVersion = existsSync(runtimeVersionFile) ? readFileSync(runtimeVersionFile, "utf8").trim() : "";
        add(
          "git-policy-version",
          runtimeVersion === expectedVersion ? "pass" : "error",
          runtimeVersion
            ? `Project runtime ${runtimeVersion}; CLI package ${expectedVersion}.`
            : `Project runtime version is missing; CLI package ${expectedVersion}.`,
        );
        add(
          "native-git-hooks",
          snapshot.git.hooksPath === ".gitflow-sentinel/githooks" ? "pass" : "error",
          snapshot.git.hooksPath === ".gitflow-sentinel/githooks"
            ? "Native pre-commit, commit-msg, and pre-push hooks are active."
            : `core.hooksPath is '${snapshot.git.hooksPath || "<unset>"}'; native Sentinel hooks are not active.`,
        );

        if (desired.agents.enabled.includes("codex")) {
          const hookFile = path.join(args.projectRoot, ".codex/hooks.json");
          const wired = existsSync(hookFile) && /gitflow-sentinel[\\/]hooks[\\/]guard\.mjs/.test(readFileSync(hookFile, "utf8"));
          add(
            "codex-hooks",
            wired ? "warning" : "error",
            wired
              ? "Codex hooks are configured; review/trust their current hash with /hooks before relying on direct-edit blocking."
              : "Codex hook wiring is missing.",
          );
        }
        if (desired.agents.enabled.includes("claude")) {
          const hookFile = path.join(args.projectRoot, ".claude/settings.json");
          const wired = existsSync(hookFile) && /gitflow-sentinel[\\/]hooks[\\/]guard\.mjs/.test(readFileSync(hookFile, "utf8"));
          add("claude-hooks", wired ? "pass" : "error", wired ? "Claude Code hook wiring is present." : "Claude Code hook wiring is missing.");
        }
      }
    }

    if (!snapshot.provider.github.checked) add("github-cli", "pass", "Remote checks were skipped; use --remote to diagnose GitHub.");
    else if (!snapshot.provider.github.available) add("github-cli", "warning", "GitHub CLI is unavailable; local planning still works.");
    else if (!snapshot.provider.github.authenticated) add("github-cli", "warning", "GitHub CLI is not authenticated; R3 GitHub actions will remain unavailable.");
    else add("github-cli", "pass", snapshot.provider.github.connected ? `Connected to ${snapshot.provider.github.slug}.` : "Authenticated; no GitHub remote is connected.");

    const transactions = snapshot.git.isRepo ? listTransactions(args.projectRoot) : [];
    if (transactions.some((item) => ["applying", "failed", "partial-rollback", "invalid"].includes(item.status))) {
      add("transactions", "error", "A transaction requires recovery or manual review.");
    } else {
      add("transactions", "pass", `${transactions.length} transaction record(s); none require recovery.`);
    }

    const result = {
      root: path.resolve(args.projectRoot),
      healthy: !checks.some((check) => check.status === "error"),
      checks,
      configPresent: existsSync(path.join(args.projectRoot, "sentinel.config.json")),
    };
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Sentinel doctor: ${result.healthy ? "PASS" : "FAIL"}`);
      for (const check of checks) console.log(`- ${check.status.toUpperCase()} ${check.id}: ${check.detail}`);
    }
    if (!result.healthy) process.exitCode = 1;
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
