#!/usr/bin/env node
// managed-by: gitflow-sentinel (skill tooling)
// Clean removal. Open-source users should be able to try the guardrails and back
// them out completely with one command. Reads the manifest, de-merges the agent
// wirings, restores the previous core.hooksPath, and strips the managed snippets.
// Read-only by default; --apply performs the removal. Never touches your history.
import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git, isFailure, readJsonSafe, nextValue, resolveProjectRoot } from "./lib.mjs";
import { hashFile } from "./core/contracts.mjs";

function parseArgs(argv) {
  const args = { projectRoot: ".", apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--project-root") { args.projectRoot = nextValue(argv, i, a); i += 1; }
    else if (a === "--apply") args.apply = true;
    else if (a === "--dry-run") args.apply = false;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const OWNS = ".gitflow-sentinel"; // command/path marker identifying our additions

// Remove hook entries whose command references the runtime, drop empty events.
// If the file ends up an empty object (it only ever held our wiring), delete it.
function demergeWiring(file, actions) {
  if (!existsSync(file)) return;
  const json = readJsonSafe(file);
  if (!json?.hooks) return;
  for (const [event, entries] of Object.entries(json.hooks)) {
    const kept = entries.filter((e) => !(e.hooks || []).some((h) => String(h.command || "").includes(OWNS)));
    if (kept.length) json.hooks[event] = kept;
    else delete json.hooks[event];
  }
  if (!Object.keys(json.hooks).length) delete json.hooks;
  if (Object.keys(json).length === 0) actions.push({ kind: "delete", file });
  else actions.push({ kind: "rewrite", file, content: `${JSON.stringify(json, null, 2)}\n` });
}

// Remove our managed block (marker-wrapped) and any remaining line mentioning the
// runtime, leaving unrelated user rules intact. Delete the file if nothing else
// is left.
function stripManaged(file, actions) {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, "utf8");
  let out = raw.replace(/\n?#\s*gitflow-sentinel:start[\s\S]*?#\s*gitflow-sentinel:end\n?/g, "\n");
  out = out.split(/\r?\n/).filter((l) => !/gitflow-sentinel/i.test(l)).join("\n");
  out = out.replace(/\n{3,}/g, "\n\n").trimEnd();
  if (out === raw.trimEnd()) return; // nothing of ours in here
  if (out.trim() === "") actions.push({ kind: "delete", file });
  else actions.push({ kind: "rewrite", file, content: `${out}\n` });
}

// Remove our activate step from package.json "prepare".
function cleanPrepare(file, actions) {
  if (!existsSync(file)) return;
  const json = readJsonSafe(file);
  const prepare = json?.scripts?.prepare;
  if (!prepare || !prepare.includes("activate.mjs")) return;
  const cleaned = prepare
    .split("&&")
    .map((s) => s.trim())
    .filter((s) => !s.includes("activate.mjs"))
    .join(" && ");
  if (cleaned) json.scripts.prepare = cleaned;
  else delete json.scripts.prepare;
  actions.push({ kind: "rewrite", file, content: `${JSON.stringify(json, null, 2)}\n` });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log("Usage: node uninstall.mjs --project-root <path> [--apply]"); return; }

  const root = resolveProjectRoot(args.projectRoot);
  const manifestPath = path.join(root, ".gitflow-sentinel", "manifest.json");
  const manifest = readJsonSafe(manifestPath) || {};
  const actions = [];

  // Restore the previous core.hooksPath (saved at install), else unset ours.
  const current = git(root, ["config", "--local", "core.hooksPath"]);
  const currentPath = isFailure(current) ? "" : String(current).trim();
  if (currentPath === ".gitflow-sentinel/githooks") {
    actions.push({ kind: "hookspath", restore: manifest.previousHooksPath || null });
  }

  demergeWiring(path.join(root, ".claude/settings.json"), actions);
  demergeWiring(path.join(root, ".codex/hooks.json"), actions);
  stripManaged(path.join(root, ".gitignore"), actions);
  stripManaged(path.join(root, ".gitattributes"), actions);
  cleanPrepare(path.join(root, "package.json"), actions);

  // Manifest-driven removal of files we created. A file changed after install
  // is preserved rather than silently deleted or overwritten.
  const ADVISORY = new Set(["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", ".github/PULL_REQUEST_TEMPLATE.md"]);
  const HANDLED = new Set([".claude/settings.json", ".codex/hooks.json", ".gitignore", ".gitattributes"]);
  let keepRuntime = false;
  for (const [rel, info] of Object.entries(manifest.files || {})) {
    const f = path.join(root, rel);
    if (HANDLED.has(rel)) continue;
    if (info.afterHash && existsSync(f) && hashFile(f) !== info.afterHash) {
      actions.push({ kind: "preserve", file: f, reason: "changed after Sentinel installed it" });
      if (rel.startsWith(".gitflow-sentinel/")) keepRuntime = true;
      continue;
    }
    if (info.action === "replace-with-backup" && info.backup) {
      const backup = path.join(root, info.backup);
      if (existsSync(backup)) actions.push({ kind: "restore", file: f, backup });
      if (rel.startsWith(".gitflow-sentinel/")) keepRuntime = true;
      continue;
    }
    if (!["create", "update-managed"].includes(info.action)) continue;
    if (ADVISORY.has(rel) && !info.afterHash) continue; // compatibility with old manifests
    if (rel.startsWith(".gitflow-sentinel/")) {
      if (existsSync(f)) actions.push({ kind: "delete", file: f });
      continue;
    }
    if (existsSync(f)) actions.push({ kind: "delete", file: f });
  }

  if (!keepRuntime) actions.push({ kind: "rmdir", dir: path.join(root, ".gitflow-sentinel") });

  console.log("gitflow-sentinel uninstall");
  console.log(`Mode: ${args.apply ? "apply" : "dry-run"}\n`);
  for (const a of actions) {
    if (a.kind === "rmdir") console.log(`- remove directory: ${path.relative(root, a.dir)}/`);
    else if (a.kind === "hookspath") console.log(`- core.hooksPath: ${a.restore ? `restore to '${a.restore}'` : "unset"}`);
    else if (a.kind === "delete") console.log(`- delete: ${path.relative(root, a.file)}`);
    else if (a.kind === "restore") console.log(`- restore: ${path.relative(root, a.file)} from ${path.relative(root, a.backup)}`);
    else if (a.kind === "preserve") console.log(`- preserve: ${path.relative(root, a.file)} (${a.reason})`);
    else console.log(`- rewrite: ${path.relative(root, a.file)}`);
  }

  if (!args.apply) {
    console.log("\nDry-run only. Re-run with --apply to remove. Files/agent wirings left untouched.");
    console.log("Project docs (AGENTS.md/CONTRIBUTING.md/CLAUDE.md) are NOT auto-edited — review them by hand.");
    return;
  }

  for (const a of actions) {
    if (a.kind === "rewrite") writeFileSync(a.file, a.content, "utf8");
    else if (a.kind === "restore") writeFileSync(a.file, readFileSync(a.backup));
    else if (a.kind === "delete") { if (existsSync(a.file)) rmSync(a.file, { force: true }); }
    else if (a.kind === "preserve") { /* user-modified file intentionally left in place */ }
    else if (a.kind === "rmdir") { if (existsSync(a.dir)) rmSync(a.dir, { recursive: true, force: true }); }
    else if (a.kind === "hookspath") {
      if (a.restore) git(root, ["config", "--local", "core.hooksPath", a.restore]);
      else git(root, ["config", "--local", "--unset", "core.hooksPath"]);
    }
  }
  // Remove now-empty directories we created.
  for (const d of [".claude", ".codex/rules", ".codex", ".github/workflows", ".github"]) {
    const dir = path.join(root, d);
    try { if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir); } catch { /* not empty / not ours */ }
  }
  console.log("\nRemoved. Review AGENTS.md / CONTRIBUTING.md / CLAUDE.md to drop any policy prose you no longer want.");
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
