# Migrating from an earlier generation

Before this repository existed as a shared, installable skill, the same idea
was built and rebuilt project by project: an early `gitflow-sentinel` (v1.x),
later forked/renamed to `git-project-guardrails`, hand-copied into each repo
that wanted it. That generation has no `.gitflow-sentinel/` runtime, no
`.gitflow-sentinel.json` policy file, and no native git hook layer — it is
Codex-only, wired through `.codex/hooks/*.mjs` and `.codex/hooks.json` with
project-specific copies of the same few scripts.

Installing the current `gitflow-sentinel` on top of a project that still has
the old generation **without removing it first** leaves both wired at once:
`.codex/hooks.json`'s `PreToolUse` entry would call both the old
`.codex/hooks/git-command-guard.mjs` and the new
`.gitflow-sentinel/hooks/guard.mjs` on every tool call — double latency, two
independent policy engines that can disagree, and no single source of truth.

## 1. Detect it

```bash
node scripts/doctor.mjs --project-root <repo>
```

`doctor` reports a `LEGACY_GENERATION` problem for each of these fingerprints
if found:

- `.codex/hooks/git-command-guard.mjs`, `.codex/hooks/git-session-start.mjs`,
  `.codex/hooks/git-cycle-reminder.mjs`
- `.codex/git-project-guardrails.manifest.json`
- `.codex/rules/git-safety.rules` carrying a `managed-by:` marker other than
  `gitflow-sentinel` (e.g. `managed-by: git-project-guardrails`)
- `.codex/hooks.json` still referencing the legacy hook script paths above

If none of these fire, there is nothing to migrate — install normally.

## 2. Remove the old generation

There is no automated uninstaller for the old generation (it was never a
single reusable package, so there is no manifest to reverse against). Remove
it by hand before installing:

1. Delete the legacy hook scripts: `.codex/hooks/git-command-guard.mjs`,
   `.codex/hooks/git-session-start.mjs`, `.codex/hooks/git-cycle-reminder.mjs`,
   and `.codex/hooks/README.md` if it only documents those.
2. Delete `.codex/git-project-guardrails.manifest.json` (or the equivalent
   `gitflow-sentinel`-named manifest) if present.
3. Open `.codex/hooks.json` and remove the entries whose `command` points at
   the deleted scripts. If the file only ever held those entries, delete it —
   the installer will recreate it.
4. Leave `.codex/rules/git-safety.rules`, `AGENTS.md`, `CONTRIBUTING.md`,
   `CLAUDE.md`, and the GitHub PR template/workflow in place — the installer
   below updates `git-safety.rules` in place and flags the prose docs for your
   own editorial pass (`agent-integrate`), it does not need them pre-deleted.
5. Commit this removal on its own short branch before installing, so the
   "remove legacy" and "install gitflow-sentinel" changes are reviewable
   separately:

   ```bash
   git switch -c chore/remove-legacy-guardrails
   git add -A
   git commit -m "chore: remove legacy git-project-guardrails hooks"
   ```

## 3. Install the current generation

```bash
node scripts/orchestrate.mjs --project-root <repo> --dry-run
node scripts/orchestrate.mjs --project-root <repo> --apply
```

Re-run `doctor` afterward — `LEGACY_GENERATION` should no longer appear, and
`CHECK 6` (native git hooks active) should show `PASS`, which the old
generation never had (it had no native layer at all).

## 4. What changes for the team

- **Config lives in one place now**: `.gitflow-sentinel.json` at the repo
  root, instead of behavior implied by whatever the copied scripts happened to
  hard-code for that project.
- **A real local boundary exists**: the native `pre-commit`/`commit-msg`/
  `pre-push` hooks enforce even when no agent is involved — the old generation
  only ever fired inside a Codex session.
- **Claude Code is covered too** (`--platform both`, the default) — the old
  generation was Codex-only.
- **`GITFLOW_OVERRIDE=explicit`** replaces whatever ad hoc override convention
  the old generation's `CONTRIBUTING.md` documented; update any team habits or
  scripts that referenced the old marker text.
