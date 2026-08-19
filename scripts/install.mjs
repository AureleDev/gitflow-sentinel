#!/usr/bin/env node
// managed-by: gitflow-sentinel (skill tooling)
// Installs the gitflow-sentinel runtime and wires it into the target repo for
// Codex and/or Claude Code. Deterministic file work lives here; project-facing
// docs (AGENTS/CONTRIBUTING/CLAUDE) are left for the agent to integrate so local
// content is preserved. Never commits, pushes, merges, or deletes.
import { existsSync, chmodSync, appendFileSync, mkdirSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import path from "node:path";
import {
  SKILL_NAME, SKILL_ROOT, TEMPLATE_ROOT, RUNTIME_VERSION,
  run, isFailure, normalizeRel, listFiles, renderTemplate, readJsonSafe,
  writeText, backupPath, isManaged, mergeHooks, gitReadiness, BOOTSTRAP_ALLOWED, git, detectHookManager,
  nextValue, resolveProjectRoot, ACTIVATE_PREPARE_COMMAND, LEGACY_ACTIVATE_PREPARE_COMMAND,
} from "./lib.mjs";
import { loadConfig, assertValidConfig } from "../assets/templates/runtime/.gitflow-sentinel/core/config.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { hashFile } from "./core/contracts.mjs";

const ADVISORY_DOCS = new Set(["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", ".github/PULL_REQUEST_TEMPLATE.md"]);

function parseArgs(argv) {
  const args = {
    projectRoot: ".", projectName: "", dryRun: false, apply: false, doctor: false,
    platform: "both", bootstrapDocs: false, bootstrap: false, allowUnsafeApply: false, verify: false,
    gitHooks: true, githubProtection: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--project-root") { args.projectRoot = nextValue(argv, i, a); i += 1; }
    else if (a === "--project-name") { args.projectName = nextValue(argv, i, a); i += 1; }
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--apply") args.apply = true;
    else if (a === "--doctor") args.doctor = true;
    else if (a === "--platform") { args.platform = nextValue(argv, i, a); i += 1; }
    else if (a === "--bootstrap-docs") args.bootstrapDocs = true;
    else if (a === "--bootstrap") args.bootstrap = true;
    else if (a === "--git-hooks") args.gitHooks = true;
    else if (a === "--no-git-hooks") args.gitHooks = false;
    else if (a === "--github-protection") args.githubProtection = true;
    else if (a === "--allow-unsafe-apply") args.allowUnsafeApply = true;
    else if (a === "--verify") args.verify = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.dryRun && !args.apply && !args.doctor) args.dryRun = true;
  if (args.dryRun && args.apply) throw new Error("Choose either --dry-run or --apply, not both.");
  if (!["both", "codex", "claude"].includes(args.platform)) throw new Error("--platform must be both|codex|claude.");
  return args;
}

function usage() {
  console.log(`Usage:
node install.mjs --project-root <path> [--project-name <name>] [--dry-run|--apply]
  [--platform both|codex|claude] [--git-hooks|--no-git-hooks] [--github-protection]
  [--bootstrap] [--bootstrap-docs] [--allow-unsafe-apply] [--verify] [--doctor]

Installs two enforcement layers from one engine:
- Agent layer (--platform both|codex|claude): wires .codex/hooks.json and/or
  .claude/settings.json so the rules fire whichever coding agent you use.
- Native git layer (--git-hooks, default on): installs real pre-commit /
  commit-msg / pre-push hooks via core.hooksPath, so the rules also fire on plain
  'git' commands run by a human or any tool. Use --no-git-hooks to skip it.

Also installs the GitHub PR template + policy workflow and a default
.gitflow-sentinel.json. Project docs are flagged for agent integration unless
--bootstrap-docs creates them.

--bootstrap seeds the engine onto the base branch (stable/integration) for a new
repo, so the stable branch is protected from its first commit and every branch
cut from it inherits the guardrails. It relaxes the "must be on a short branch"
gate (a dirty worktree or a current legacy branch still blocks). After a
--bootstrap apply, commit the seed once with an override marker, then create the
integration branch from it.

Never commits, pushes, merges, or deletes.`);
}

// Decide how a template file maps onto the target repo.
function classify(relFromTemplate, platform) {
  const parts = relFromTemplate.split(path.sep);
  const group = parts[0];
  const rel = normalizeRel(parts.slice(1).join(path.sep));

  if (group === "runtime") return { kind: "managed", rel };
  if (group === "github") return { kind: ADVISORY_DOCS.has(rel) ? "advisory" : "managed", rel };
  if (group === "shared") {
    if (rel === ".gitflow-sentinel.json") return { kind: "config", rel };
    if (rel === "gitignore-snippet.txt") return { kind: "gitignore", rel };
    if (rel === "gitattributes-snippet.txt") return { kind: "gitattributes", rel };
    if (ADVISORY_DOCS.has(rel)) return { kind: "advisory", rel };
    return { kind: "managed", rel };
  }
  if (group === "codex") {
    if (platform === "claude") return null;
    return rel === ".codex/hooks.json" ? { kind: "wiring-json", rel } : { kind: "managed", rel };
  }
  if (group === "claude") {
    if (platform === "codex") return null;
    return rel === ".claude/settings.json" ? { kind: "wiring-json", rel } : { kind: "managed", rel };
  }
  return null;
}

async function planItem(root, ctx, src, info, bootstrapDocs) {
  const target = path.join(root, info.rel);
  const rendered = renderTemplate(await readFile(src, "utf8"), ctx);

  if (info.kind === "gitignore") return planGitignore(root, rendered);
  if (info.kind === "gitattributes") return planGitattributes(root, rendered);

  if (info.kind === "config") {
    return existsSync(target)
      ? { action: "keep-config", rel: info.rel, target }
      : { action: "create", rel: info.rel, target, content: rendered };
  }

  if (info.kind === "advisory") {
    if (existsSync(target)) return { action: "agent-integrate", rel: info.rel, target };
    return bootstrapDocs
      ? { action: "create", rel: info.rel, target, content: rendered }
      : { action: "suggest-create", rel: info.rel, target, content: rendered };
  }

  if (info.kind === "wiring-json") {
    if (!existsSync(target)) return { action: "create", rel: info.rel, target, content: rendered };
    const existing = readJsonSafe(target);
    if (!existing) {
      return {
        action: "invalid-json",
        rel: info.rel,
        target,
        detail: "existing JSON is invalid; repair it or move it aside explicitly",
      };
    }
    const merged = mergeHooks(existing, JSON.parse(rendered));
    return { action: "merge-json", rel: info.rel, target, content: `${JSON.stringify(merged, null, 2)}\n` };
  }

  // managed
  if (!existsSync(target)) return { action: "create", rel: info.rel, target, content: rendered };
  const existing = await readFile(target, "utf8");
  if (existing === rendered) return { action: "unchanged", rel: info.rel, target, content: rendered };
  if (isManaged(existing)) return { action: "update-managed", rel: info.rel, target, content: rendered };
  return { action: "replace-with-backup", rel: info.rel, target, backup: backupPath(target), content: rendered };
}

// Wrap an appended snippet in block markers so uninstall can remove exactly what
// we added (comments included), leaving any surrounding user rules untouched.
function wrapBlock(snippet) {
  return `# gitflow-sentinel:start\n${snippet.trim()}\n# gitflow-sentinel:end`;
}

function planGitignore(root, snippet) {
  const target = path.join(root, ".gitignore");
  const block = wrapBlock(snippet);
  if (!existsSync(target)) return { action: "create", rel: ".gitignore", target, content: `${block}\n` };
  return { action: "append-gitignore", rel: ".gitignore", target, content: block };
}

function planGitattributes(root, snippet) {
  const target = path.join(root, ".gitattributes");
  const block = wrapBlock(snippet);
  if (!existsSync(target)) return { action: "create", rel: ".gitattributes", target, content: `${block}\n` };
  return { action: "append-gitattributes", rel: ".gitattributes", target, content: block };
}

async function buildPlan(root, ctx, platform, bootstrapDocs) {
  const files = listFiles(TEMPLATE_ROOT);
  const plan = [];
  for (const src of files) {
    const relFromTemplate = path.relative(TEMPLATE_ROOT, src);
    const info = classify(relFromTemplate, platform);
    if (!info) continue;
    plan.push(await planItem(root, ctx, src, info, bootstrapDocs));
  }
  return plan;
}

async function applyPlan(root, plan, meta = {}) {
  const manifest = {
    managedBy: SKILL_NAME, version: RUNTIME_VERSION, updatedAt: new Date().toISOString(),
    previousHooksPath: meta.previousHooksPath || "", hookManager: meta.hookManager || null, files: {},
  };
  // Best-effort transactionality: if a write fails partway, restore the backups
  // we just made and surface a clear partial-install error instead of leaving a
  // silently half-installed repo.
  const undo = [];
  const recorded = new Set();
  const recordUndo = async (target) => {
    if (recorded.has(target)) return;
    recorded.add(target);
    undo.push({ target, existed: existsSync(target), prior: existsSync(target) ? await readFile(target) : null });
  };
  try {
    for (const item of plan) {
      if (item.action === "invalid-json") throw new Error(`${item.rel}: ${item.detail}`);
      if (["unchanged", "keep-config", "agent-integrate", "suggest-create"].includes(item.action)) continue;
      await recordUndo(item.target);
      if (item.action === "replace-with-backup") {
        const prior = await readFile(item.target);
        await writeText(item.backup, prior);
      }
      if (item.action === "append-gitignore") {
        const existing = await readFile(item.target, "utf8");
        if (existing.includes(".gitflow-sentinel/logs/")) { manifest.files[item.rel] = { action: "unchanged" }; continue; }
        const sep = existing.endsWith("\n") ? "" : "\n";
        await writeText(item.target, `${existing}${sep}\n${item.content}\n`);
      } else if (item.action === "append-gitattributes") {
        const existing = await readFile(item.target, "utf8");
        if (existing.includes(".gitflow-sentinel/githooks/")) { manifest.files[item.rel] = { action: "unchanged" }; continue; }
        const sep = existing.endsWith("\n") ? "" : "\n";
        await writeText(item.target, `${existing}${sep}\n${item.content}\n`);
      } else {
        await writeText(item.target, item.content);
      }
      manifest.files[item.rel] = {
        action: item.action,
        ...(item.backup ? { backup: normalizeRel(path.relative(root, item.backup)) } : {}),
        afterHash: hashFile(item.target),
      };
    }
    await writeText(path.join(root, ".gitflow-sentinel", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    for (const u of undo.reverse()) {
      try {
        if (u.existed) await writeFile(u.target, u.prior);
        else {
          rmSync(u.target, { force: true });
          let directory = path.dirname(u.target);
          while (directory.startsWith(`${path.resolve(root)}${path.sep}`) && directory !== path.resolve(root)) {
            if (readdirSync(directory).length) break;
            rmdirSync(directory);
            directory = path.dirname(directory);
          }
        }
      } catch { /* leave the .bak as the recovery path */ }
    }
    throw new Error(`Install aborted and rolled back modified files: ${error.message}`, { cause: error });
  }
}

const HOOK_ARGS = { "pre-commit": "", "commit-msg": '"$1"', "pre-push": '"$@"' };

// Activates the native git layer. Three paths:
//  - No hook manager: own core.hooksPath, and wire `prepare` so a fresh clone
//    re-arms automatically (the piece husky used to be needed for).
//  - Husky present: do NOT fight over core.hooksPath — inject our checks INTO the
//    existing .husky/* hooks so lint-staged/commitlint keep working alongside.
//  - lefthook / pre-commit framework: print exact integration guidance.
async function enableNativeHooks(root, apply, previousHooksPath) {
  const rel = ".gitflow-sentinel/githooks";
  const dir = path.join(root, rel);
  console.log("\nNative git hooks:");
  if (!existsSync(dir)) { console.log("- githooks not present (run --apply first)."); return; }

  for (const f of ["pre-commit", "commit-msg", "pre-push", "native.mjs"]) {
    try { chmodSync(path.join(dir, f), 0o755); } catch { /* best effort (Windows) */ }
  }

  // Reuse the core.hooksPath read from main() instead of re-querying git —
  // nothing between there and here changes it, so a second spawn would be
  // redundant.
  const existing = previousHooksPath;
  const manager = detectHookManager(root);
  const husky = manager?.name === "husky" || /(^|\/)\.husky(\/|$)/.test(existing);

  if (husky) {
    await injectIntoHusky(root, apply);
    return;
  }
  if (manager?.name === "lefthook") {
    console.log("- lefthook detected. Add to lefthook.yml so the engine runs alongside your hooks:");
    for (const h of ["pre-commit", "commit-msg", "pre-push"]) {
      console.log(`    ${h}:\n      commands:\n        gitflow-sentinel:\n          run: node ${rel}/native.mjs ${h} ${HOOK_ARGS[h] || ""}`.trimEnd());
    }
    return;
  }
  if (manager?.name === "pre-commit") {
    console.log("- pre-commit framework detected. Add a local hook to .pre-commit-config.yaml that runs");
    console.log(`  'node ${rel}/native.mjs pre-commit' (and a pre-push stage), so both run.`);
    return;
  }
  if (existing && existing !== rel) {
    console.log(`- core.hooksPath is already set to '${existing}' (unknown manager).`);
    console.log(`  Integrate manually: have ${existing} also call '${rel}/native.mjs <hook>'.`);
    return;
  }
  if (!apply) {
    console.log(`- would set core.hooksPath = ${rel} and wire a package.json "prepare" re-arm on --apply.`);
    return;
  }
  const set = git(root, ["config", "--local", "core.hooksPath", rel]);
  if (isFailure(set)) console.log(`- could not set core.hooksPath: ${set.message}`);
  else console.log(`- core.hooksPath = ${rel} (pre-commit, commit-msg, pre-push now enforce on every git command).`);
  await injectPrepare(root, apply);
}

// Append our native call to each husky hook (creating the file if needed) with a
// managed marker so re-runs stay idempotent and uninstall can strip it.
async function injectIntoHusky(root, apply) {
  const huskyDir = path.join(root, ".husky");
  console.log("- husky detected: injecting gitflow-sentinel into .husky/* (core.hooksPath left to husky).");
  for (const hook of ["pre-commit", "commit-msg", "pre-push"]) {
    const file = path.join(huskyDir, hook);
    const line = `node .gitflow-sentinel/githooks/native.mjs ${hook} ${HOOK_ARGS[hook] || ""}`.trimEnd();
    const existing = existsSync(file) ? await readFile(file, "utf8") : "";
    if (existing.includes(".gitflow-sentinel/githooks/native.mjs")) {
      console.log(`  - ${hook}: already injected.`);
      continue;
    }
    if (!apply) { console.log(`  - would inject into .husky/${hook}.`); continue; }
    mkdirSync(huskyDir, { recursive: true });
    if (existing) {
      appendFileSync(file, `${existing.endsWith("\n") ? "" : "\n"}\n# managed-by: gitflow-sentinel\n${line}\n`);
    } else {
      await writeText(file, `#!/usr/bin/env sh\n# managed-by: gitflow-sentinel\n${line}\n`);
    }
    try { chmodSync(file, 0o755); } catch { /* best effort (Windows) */ }
    console.log(`  - injected into .husky/${hook}.`);
  }
}

// Wire `node .gitflow-sentinel/activate.mjs` into package.json "prepare" so a
// fresh clone re-arms core.hooksPath on the next install — the same mechanism
// husky uses. No-op on non-Node repos (handled by the runtime note instead).
async function injectPrepare(root, apply) {
  const pkgPath = path.join(root, "package.json");
  if (!existsSync(pkgPath)) {
    console.log("- no package.json: run `node .gitflow-sentinel/activate.mjs` once per clone to re-arm hooks.");
    return;
  }
  const pkg = readJsonSafe(pkgPath);
  if (!pkg) { console.log("- package.json is not valid JSON; skipped prepare wiring."); return; }
  const step = ACTIVATE_PREPARE_COMMAND;
  const prepare = pkg.scripts?.prepare || "";
  if (prepare.includes(step) && !prepare.includes(LEGACY_ACTIVATE_PREPARE_COMMAND)) { console.log("- package.json prepare already re-arms hooks."); return; }
  if (!apply) { console.log('- would add a "prepare" re-arm step to package.json on --apply.'); return; }
  const retained = prepare
    .split(/\s*&&\s*/)
    .map((part) => part.trim())
    .filter((part) => part && part !== LEGACY_ACTIVATE_PREPARE_COMMAND);
  if (!retained.includes(step)) retained.push(step);
  pkg.scripts = pkg.scripts || {};
  pkg.scripts.prepare = retained.join(" && ");
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.log('- package.json "prepare" now re-arms hooks on install (survives fresh clones).');
}

function printPlan(plan, apply) {
  console.log(apply ? "\nApply plan:" : "\nDry-run plan:");
  for (const item of plan) {
    if (item.action === "suggest-create") console.log(`- suggest-create: ${item.rel} (use --bootstrap-docs to create)`);
    else if (item.action === "replace-with-backup") console.log(`- replace-with-backup: ${item.rel} -> ${path.basename(item.backup)}`);
    else console.log(`- ${item.action}: ${item.rel}`);
  }
}

// Returns the problems that actually block this apply, honoring --bootstrap.
function blockingProblems(readiness, bootstrap) {
  if (!bootstrap) return readiness.problems;
  return readiness.problems.filter((p) => !BOOTSTRAP_ALLOWED.has(p.code));
}

function printReadiness(readiness, apply, allowUnsafe, bootstrap) {
  console.log("\nGit readiness:");
  if (!readiness.isRepo) { console.log("- not a git repository"); return; }
  if (!readiness.problems.length && !readiness.warnings.length) { console.log("- ok"); return; }
  for (const w of readiness.warnings) console.log(`- warning: ${w}`);
  const blocking = blockingProblems(readiness, bootstrap);
  const blockingCodes = new Set(blocking.map((p) => p.code));
  for (const p of readiness.problems) {
    const downgraded = bootstrap && !blockingCodes.has(p.code);
    console.log(`- ${downgraded ? "bootstrap-allowed" : "problem"}: ${p.msg}`);
  }
  if (blocking.length) {
    if (apply && !allowUnsafe) console.log("- apply refused until these are fixed (override: --allow-unsafe-apply).");
    else if (apply && allowUnsafe) console.log("- unsafe apply override active; proceed only with explicit approval.");
    else console.log("- dry-run only; fix before --apply.");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  const root = resolveProjectRoot(args.projectRoot);

  if (args.doctor) {
    const out = run(process.execPath, [path.join(SKILL_ROOT, "scripts", "doctor.mjs"), "--project-root", root], root);
    console.log(isFailure(out) ? out.stdout || out.message : out);
    if (isFailure(out)) process.exit(1);
    return;
  }

  const config = assertValidConfig(loadConfig(root));
  const projectName = args.projectName || path.basename(root);
  const ctx = {
    projectName,
    guardrailsVersion: RUNTIME_VERSION,
    worktreeRoot: `../${projectName}-worktrees`,
    overrideMarker: config.overrideMarker,
    stableBranch: config.stableBranch,
    integrationBranch: config.integrationBranch,
    legacyBranch: config.legacyBranch,
    shortPrefixes: config.shortBranchPrefixes.join(", "),
  };

  console.log(`${SKILL_NAME} ${args.apply ? "apply" : "dry-run"}`);
  console.log(`Runtime version: ${RUNTIME_VERSION}`);
  console.log(`Project: ${projectName}`);
  console.log(`Root: ${root}`);
  console.log(`Platform (agent layer): ${args.platform}`);
  console.log(`Native git hooks layer: ${args.gitHooks ? "yes" : "no"}`);
  console.log(`Config source: ${config._source}`);
  if (config._source.startsWith("defaults (invalid")) console.log("WARNING: config file is invalid JSON; defaults will be used.");
  if (!existsSync(path.join(root, "package.json"))) {
    console.log("Runtime note: this repo has no package.json. The hooks run via Node, so ensure `node` is on PATH");
    console.log("  for whoever runs git here, and re-arm a fresh clone with: node .gitflow-sentinel/activate.mjs");
  }

  if (args.bootstrap) console.log("Bootstrap: yes (seeding the engine onto the base branch)");

  const readiness = gitReadiness(root, config);
  printReadiness(readiness, args.apply, args.allowUnsafeApply, args.bootstrap);
  const blocking = readiness.isRepo ? blockingProblems(readiness, args.bootstrap) : [];
  if (args.apply && !readiness.isRepo) {
    throw new Error("Install --apply requires an existing Git repository. Use `gitflow-sentinel init` for a greenfield project.");
  }
  if (args.apply && blocking.length && !args.allowUnsafeApply) {
    throw new Error("Unsafe Git state for --apply. Fix the problems above or use --allow-unsafe-apply after explicit approval.");
  }

  const plan = await buildPlan(root, ctx, args.platform, args.bootstrapDocs);
  printPlan(plan, args.apply);

  const prevHp = git(root, ["config", "--local", "core.hooksPath"]);
  const previousHooksPath = isFailure(prevHp) ? "" : String(prevHp).trim();

  let localInstalled = false;
  try {
    if (args.apply) {
      await applyPlan(root, plan, { previousHooksPath, hookManager: detectHookManager(root)?.name || null });
      localInstalled = true;
      console.log("\nInstalled. Project docs marked 'agent-integrate' still need your editorial pass.");
      if (args.bootstrap) {
        const seedBranch = readiness.branch || config.stableBranch;
        console.log("\nBootstrap seed — the engine is now in the working tree but not committed. To protect the base branch:");
        console.log(`  git add -A`);
        console.log(`  ${config.overrideMarker} git commit -m "chore: bootstrap gitflow-sentinel guardrails" -m "" -m "seed guardrails onto ${seedBranch}"`);
        if (config.integrationBranch !== config.stableBranch && !readiness.branches?.has(config.integrationBranch)) {
          console.log(`  git switch -c ${config.integrationBranch}   # create the integration branch from the seeded base`);
        }
        console.log("Every branch cut from here will inherit the guardrails.");
      }
    } else {
      console.log("\nNo files written. Re-run with --apply to install.");
    }

    if (args.gitHooks) await enableNativeHooks(root, args.apply, previousHooksPath);

    if (args.githubProtection) {
      console.log("\nServer-side GitHub branch protection:");
      if (!args.apply) {
        console.log("- would run github-protect (dry-run). On --apply it configures protection via gh.");
        const out = run(process.execPath, [path.join(SKILL_ROOT, "scripts", "github-protect.mjs"), "--project-root", root], root);
        console.log(isFailure(out) ? (out.stdout || out.message) : out);
      } else {
        const out = run(process.execPath, [path.join(SKILL_ROOT, "scripts", "github-protect.mjs"), "--project-root", root, "--apply"], root);
        console.log(isFailure(out) ? (out.stdout || out.message) : out);
        if (isFailure(out)) throw new Error("GitHub protection failed; server enforcement was not applied.");
      }
    }

    if (args.verify) {
      if (!args.apply) throw new Error("--verify requires --apply.");
      const out = run(process.execPath, [path.join(SKILL_ROOT, "scripts", "verify.mjs"), "--project-root", root], root);
      console.log("\nVerification:");
      console.log(isFailure(out) ? (out.stdout || out.message) : out);
      if (isFailure(out)) throw new Error("Verification failed.");
    }
  } catch (error) {
    if (localInstalled) {
      const undone = run(process.execPath, [path.join(SKILL_ROOT, "scripts", "uninstall.mjs"), "--project-root", root, "--apply"], root);
      if (isFailure(undone)) {
        throw new Error(`${error.message} Automatic local uninstall also failed: ${undone.message}`, { cause: error });
      }
      throw new Error(`${error.message} Local installation was rolled back.`, { cause: error });
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
