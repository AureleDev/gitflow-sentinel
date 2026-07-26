---
name: gitflow-sentinel
description: Install, audit, and enforce safe Git/GitHub branch discipline in a project — protected branches, PR routing, and commit/push guardrails — for both Codex and Claude Code, with native git hooks, optional server-side GitHub branch protection, and clean uninstall. Use whenever setting up branch protection or a branching workflow in a repo, preventing direct commits or pushes to main/dev, blocking force-pushes or remote deletion of protected branches, blocking secret or .env commits, blocking --no-verify / core.hooksPath bypasses, enforcing Conventional Commits, configuring Codex or Claude Code git hooks, coexisting with or replacing husky/lefthook, normalizing a legacy master branch, auditing an existing repo's branch/git hygiene, adopting a trunk-based or git-flow policy, or porting this Git discipline to another project — even if the user only says "set up git", "protect main", "add guardrails", "require PRs", or "clean up our branching". This installs branch-policy guardrails; it is not for writing commit messages, resolving merge conflicts, editing history, lint/format pre-commit hooks, or CI test workflows.
---

# gitflow-sentinel

Installs a small, configurable Git/GitHub policy engine into a repository so
unsafe operations are blocked with an explanation, not just discouraged in a doc.

One engine, one config, two enforcement layers (plus an optional third):

- **Agent layer** — wires the policy into the coding agent (Codex and/or Claude
  Code). Fires when the agent runs a shell command or edits a file, blocking by
  exiting code 2 and printing the reason, a convention both runtimes honor, so
  one set of hook scripts serves both; only the wiring file differs
  (`.codex/hooks.json` vs `.claude/settings.json`). It is a smart-assistant guard
  that closes the obvious and accidental bypasses — **not** a hard security
  boundary.
- **Native git layer** — real `pre-commit` / `commit-msg` / `pre-push` hooks. This
  is the **real boundary**: it fires on **any** git operation — a human typing
  `git commit`, a script, any tool — so the rules hold even outside an agent and
  even if the agent guard is bypassed.
- **Server-side layer (optional)** — `--github-protection` configures GitHub
  branch protection via `gh`, so a direct push or force-push to a protected
  branch is rejected by GitHub itself, regardless of anyone's local setup.

Both local layers call the same `core/*.mjs`, driven entirely by
`.gitflow-sentinel.json`, so the same logic serves git-flow, trunk-based, and
monorepo teams and the layers can never disagree. Pick the layers at install
time; the default installs the agent + native layers.

## Core rule

Install guardrails as a complete, verified workflow. Always inspect the target
repository first. Scripts own deterministic file work and policy decisions; the
agent owns editorial integration of project-facing docs (`AGENTS.md`,
`CONTRIBUTING.md`, `CLAUDE.md`, PR template) — edit those directly so existing
content is preserved with no duplicates or contradictions.

Never commit, merge, push, open/merge PRs, delete branches, normalize a legacy
branch, or change GitHub settings without explicit approval in the conversation.
A short branch is not "closed" after a local commit: closure means pushed with
upstream, a PR to the integration branch, an explicit merge-or-keep-open
decision, and — after an approved merge — the integration branch synced locally.

## Quick start

From the skill directory, paths are relative to this `SKILL.md`. Run the ordered
driver (read-only first):

```bash
node scripts/orchestrate.mjs --project-root <path> --dry-run
node scripts/orchestrate.mjs --project-root <path> --apply
```

`orchestrate` runs doctor → install → verify. It never commits, pushes, opens
PRs, merges, or deletes — those remain explicit steps you take with approval.

## Workflow

1. **Resolve the target root** (default: current directory).
2. **Audit first** — read-only, prints the checklist and findings:
   ```bash
   node scripts/doctor.mjs --project-root <path>
   ```
   Stop on any `PROBLEM` and report the next fix.

   A `LEGACY_GENERATION` problem means this project already has an earlier,
   per-project generation of this same idea (an old `gitflow-sentinel` v1.x, or
   its `git-project-guardrails` fork/rename — hand-copied hooks under
   `.codex/hooks/git-*.mjs`, no shared runtime, no native git layer). Do **not**
   run a fixed cleanup script blindly here: read `references/migration.md` for
   what to look for, then actually open the specific files doctor flagged in
   *this* project — the exact scripts, wiring, and doc prose vary project to
   project (versions seen in the wild range from a bare `gitflow-sentinel`
   1.1.0 through several `git-project-guardrails` forks). Understand what is
   really there, reconcile it with what the project's `AGENTS.md`/`CONTRIBUTING.md`
   already document, then remove the superseded pieces with the user's explicit
   approval before installing on top — the same "ask before anything
   destructive" rule as everywhere else in this skill. This is deliberately a
   judgment call for the agent, not a scripted, one-size-fits-all migration.
3. **Prepare the branch model.** For an established repo, installing requires
   `stableBranch` + `integrationBranch` to exist, a clean worktree, and a short
   work branch. If the repo is on a legacy branch (default `master`), or missing
   `main`/`dev`, normalize that first **with explicit approval**. For a brand-new
   repo, use the greenfield bootstrap below instead.
4. **Choose the layers, then dry-run the install** and review the plan (created /
   managed-update / merged wiring / advisory docs / backups). Confirm with the
   user which coding agents to wire and whether to enforce on plain git too:
   ```bash
   node scripts/install.mjs --project-root <path> --dry-run --platform both
   ```
   - `--platform both|codex|claude` selects the agent layer (default `both`).
   - `--git-hooks` (default) installs the native git layer; `--no-git-hooks`
     skips it. If a hook manager already owns `core.hooksPath` (husky/lefthook),
     the installer **cooperates** instead of clobbering — see *Coexistence* below.
   - `--github-protection` additionally configures server-side GitHub branch
     protection (needs an authenticated `gh`).
5. **Apply** once the readiness is clean:
   ```bash
   node scripts/install.mjs --project-root <path> --apply --platform both --verify
   ```
   The installer refuses unsafe `--apply` states (protected/legacy/dirty/missing
   branches) unless `--allow-unsafe-apply` is given after explicit approval.
6. **Integrate project docs.** `AGENTS.md`, `CONTRIBUTING.md`, `CLAUDE.md`, and
   the PR template are flagged `agent-integrate` when they already exist — edit
   them directly to adopt the policy without clobbering local content. Use
   `--bootstrap-docs` only for a fresh repo that wants them created.
7. **Commit, push, PR, close** on a short branch, following the same discipline
   the guardrails enforce. Ask for the merge-or-keep-open decision; sync the
   integration branch after an approved merge.

See `references/workflow.md` for the full lifecycle and diagrams.

## Greenfield bootstrap

The hooks load from the **working tree of the checked-out branch**. So the
stable branch must itself carry the engine, or someone who checks out a bare
`main` gets no protection until a later promotion merges the files in. For a new
repo, seed the base branch first so every branch inherits the guardrails:

```bash
# On a clean stable branch (e.g. main) with at least one commit:
node scripts/install.mjs --project-root <path> --apply --bootstrap --platform both --bootstrap-docs
git -C <path> add -A
git -C <path> commit -m "chore: bootstrap gitflow-sentinel guardrails" -m "GITFLOW_OVERRIDE=explicit: seed base branch"
git -C <path> switch -c dev   # skip for trunk-based
```

For **trunk-based** repos, set `integrationBranch` to the stable branch in
`.gitflow-sentinel.json` *before* installing, and skip the `git switch -c dev`
step — `main` is the single protected, inherited base.

## Fresh clones & the Node requirement

`core.hooksPath` is **local** git config and is **not cloned**, so a fresh clone
has no native enforcement until something re-arms it. The installer solves this:

- **Node repos**: it wires `node .gitflow-sentinel/activate.mjs` into the
  package.json `prepare` script, so `npm/pnpm/yarn install` re-arms the hooks
  automatically — the same mechanism husky uses.
- **Non-Node repos** (no install step): run `node .gitflow-sentinel/activate.mjs`
  once after cloning. The installer prints this reminder.

The runtime is Node ESM (`.mjs`); the hooks run via `node`. On a non-Node repo,
make sure `node` (>= 18) is on PATH for whoever runs git there. `doctor` reports
the Node version and flags an unusable one.

## Coexistence with an existing hook manager

If the repo already uses **husky**, the installer does not fight over
`core.hooksPath`. It **injects** a `node .gitflow-sentinel/githooks/native.mjs
<hook>` call into each existing `.husky/*` hook (with a managed marker, so re-runs
stay idempotent and uninstall can strip it). Your lint-staged / commitlint setup
keeps working, and the branch/secret guardrails run alongside it. For **lefthook**
or the **pre-commit framework**, the installer prints the exact lines to add to
`lefthook.yml` / `.pre-commit-config.yaml`.

This means gitflow-sentinel can sit on top of husky, or fully replace it — its
native layer already does husky's job (own `core.hooksPath` + auto-re-arm on
clone), so a repo can drop husky entirely if it only needs policy + secrets.

## What gets installed

| Path | Role |
|------|------|
| `.gitflow-sentinel/core/*.mjs` | Shared policy engine (config, parser, policy, secrets, external-scanner delegation, git) |
| `.gitflow-sentinel/hooks/*.mjs` | Agent layer: guard (PreToolUse), session-start, cycle-reminder (Stop) |
| `.gitflow-sentinel/githooks/*` | Native layer: pre-commit, commit-msg, pre-push + shared native.mjs |
| `.gitflow-sentinel/activate.mjs` | Re-arms `core.hooksPath` after a clone (wired into package.json `prepare`) |
| `.gitflow-sentinel.json` | The per-project branch/PR/coverage policy — **edit this to change behavior** |
| `.codex/hooks.json` | Codex agent wiring (merged into any existing hooks) |
| `.claude/settings.json` | Claude Code agent wiring (hooks key merged, other settings preserved) |
| `core.hooksPath` → `.gitflow-sentinel/githooks` | Activates the native layer (or injection into husky) |
| `.gitattributes` (snippet) | Pins the hook scripts to LF so the shebang survives a CRLF checkout |
| `.codex/rules/git-safety.rules` | Codex execpolicy: defense-in-depth for destructive commands |
| `.github/workflows/gitflow-policy.yml` | CI layer: `ci-check.mjs` mirrors the local PR routing rules on the server |
| `AGENTS.md` / `CONTRIBUTING.md` / `CLAUDE.md` / PR template | Project-facing guidance (agent-integrated) |

## What the guardrails enforce

Blocks (exit 2, reason fed back to the agent; native layer exits non-zero):

- commits/merges/resets/writes on a protected branch; short branches off the
  wrong base or with a dirty worktree; branch switches with a dirty worktree;
- direct pushes, **force-pushes**, and **remote deletion** of protected branches;
- PRs with no base, to the legacy branch, or with a disallowed head→base route;
  `gh pr merge` / API merges without a recorded approval; write-ish `gh api`
  calls (ref / branch-protection / release mutations);
- commits that stage secrets or `.env*`;
- **`--no-verify`** and **`core.hooksPath`** changes — these disable the
  guardrails and are blocked unconditionally (the override marker cannot bypass
  them, and neither can it bypass the secrets block).

Warns (severity configurable): non-Conventional commit messages, tag/release
operations, history rewrites on already-published shared branches, worktree
isolation, branch deletion, detached HEAD, missing remote/upstream.

The bypass-resistance of the agent guard is best-effort (it normalizes the git
binary path and re-analyzes `sh -c` / `eval` / command substitution / `ssh`
remote commands), but the native git layer is what truly holds. See
`references/policy.md` for the threat model.

## Configuration

Everything is driven by `.gitflow-sentinel.json`. Change branch names, add
prefixes, redefine PR routes, or tune coverage there. Notable knobs:
`conventionalCommits` and `historyProtection` / `tagProtection` are tri-state
(`off` | `warn` | `block`); `delegateScanners` defers to gitleaks/git-secrets/
commitlint when present; `policyDocPath` points the guard at your policy doc.
Full field reference: `references/configuration.md`.

## Sanctioned exceptions

For a genuinely needed one-off, record the decision so it appears in history. The
agent layer reads the marker from the command text; the native git layer reads it
from an environment variable:

```bash
# agent layer (as a trailing comment in the command):
git push origin dev   # GITFLOW_OVERRIDE=explicit: reason
# native git layer (env var on the real git command):
GITFLOW_OVERRIDE=explicit git commit -m "chore: deliberate base-branch edit"
```

The marker is configurable (`overrideMarker`). It sanctions one routine block;
it can never let a secret through, nor re-enable `--no-verify` / a `core.hooksPath`
change. It is only honored when it appears in the command itself (not in arbitrary
file content), to avoid self-poisoning.

## Uninstall

```bash
node scripts/uninstall.mjs --project-root <path>          # dry-run
node scripts/uninstall.mjs --project-root <path> --apply  # remove
```

Reads the manifest, de-merges the agent wirings, restores the previous
`core.hooksPath`, strips the managed gitignore/gitattributes/`prepare` entries,
and removes the runtime. Project docs are left for you to trim by hand.

## Platform notes

Both runtimes use the same hook scripts; differences are in
`references/platform-adapters.md`. Agents not explicitly wired (Cursor, Gemini
CLI, Copilot, Aider…) are still covered by the native git layer whenever they
invoke `git`. Verify the engine anytime with:

```bash
node scripts/verify.mjs --project-root <path>
```

## Resources

- `references/policy.md` — branch model, rule catalog, threat model, scenarios.
- `references/workflow.md` — lifecycle, diagrams, version model.
- `references/configuration.md` — every `.gitflow-sentinel.json` field.
- `references/platform-adapters.md` — Codex vs Claude Code wiring, adding a runtime.
- `scripts/` — orchestrate, doctor, install, verify, uninstall, github-protect, lib.
- `assets/templates/` — runtime engine + wiring + docs copied into projects.
