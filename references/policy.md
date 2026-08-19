# Policy reference

The branch model is data, not code. These are the **default** routes; a project
changes them in `.gitflow-sentinel.json` (see `configuration.md`).

## Branch model (defaults)

```text
feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert/*  ->  dev   (PR)
hotfix/*                                                         ->  dev or main, with approval
release/*                                                        ->  main, milestone promotion
dev                                                              ->  main, validated milestones (PR)
```

Forbidden by default:

```text
short branch -> main directly
any -> master (legacy)
direct commit/push to a protected branch
short branch created from anything but the integration branch
branch create/switch with a dirty worktree
```

## Decision codes

The policy engine returns decisions with stable codes. Blocks exit the hook with
code 2; warns print only.

| Code | Level | Trigger |
|------|-------|---------|
| `NO_VERIFY` | block (non-overridable) | `git commit/push --no-verify` or `-n` — disables every native hook at once |
| `HOOKSPATH_TAMPER` | block (non-overridable) | `git config core.hooksPath …` or `git -c core.hooksPath=…` — neutralizes the native layer |
| `DIRECT_EDIT_PROTECTED` | block | apply_patch/edit/write tool targets this repository on a protected branch |
| `MUTATION_PROTECTED` | block | git add/commit/merge/reset/… or shell write on a protected branch |
| `CREATE_DIRTY` | block | branch creation with a dirty worktree |
| `SHORT_BRANCH_BASE` | block | short branch created from a non-integration branch |
| `SWITCH_DIRTY` | block | branch switch with a dirty worktree |
| `PUSH_PROTECTED` | block | direct push to a protected branch |
| `FORCE_PUSH_PROTECTED` | block | force-push (`--force`/`+refspec`) to a protected branch — always blocked |
| `FORCE_PUSH_SHARED` | warn/block (per `historyProtection`) | force-push of a shared, already-pushed, non-protected branch |
| `PROTECTED_DELETE` | block | remote deletion of a protected branch (`push --delete main`, `push origin :main`) |
| `REWRITE_SHARED` | warn/block (per `historyProtection`) | amend / `reset --hard` / rebase on an already-published non-protected branch |
| `PR_NO_BASE` | block | `gh pr create` without `--base` |
| `PR_TO_LEGACY` | block | PR base is the legacy branch |
| `PR_ROUTE` | block | head→base route not allowed by `prRoutes` |
| `PR_MERGE` | block | `gh pr merge` / API merge without the override marker |
| `GH_API_WRITE` | block | write-ish `gh api` (refs, branch protection, releases) outside the merge path |
| `SECRET_STAGED` | block (non-overridable) | staged `.env*` file or secret-looking added line — the marker can never let a secret through |
| `TAG_OP` / `RELEASE_OP` | warn/block (per `tagProtection`) | tag create/delete/push and `gh release` create/edit/delete |
| `COMMIT_FORMAT` | warn/block (per `conventionalCommits`) | `-m` message not Conventional Commits |
| `DETACHED_HEAD` | warn | commit/mutation on a detached HEAD (work lands on no branch) |
| `WORKTREE` | warn | `git worktree` used (isolation reminder) |
| `BRANCH_DELETE` | warn | local/remote branch deletion |
| `NO_REMOTE` / `NO_UPSTREAM` | warn | push with no remote / no upstream |

## Override semantics

`overrideMarker` (default `GITFLOW_OVERRIDE=explicit`) in the **command text**
bypasses an eligible command block for that single action; the native layer reads it from the
`GITFLOW_OVERRIDE` environment variable. It is matched only in the command — not
in arbitrary file or diff content — so a file that merely contains the marker
string cannot switch the guard off (self-poisoning). It does not silence
warnings, and it is intentionally visible so the exception is recorded. Use it
only after a human approves the specific operation.

Direct-edit tool payloads do not have a portable, auditable override channel.
Their marker is therefore ignored: on a protected branch, edit the repository
from a short branch. A direct edit whose resolved target is outside the current
worktree is outside this repository policy and is not blocked.

Four blocks **ignore the marker on purpose**: `DIRECT_EDIT_PROTECTED` has no
portable override channel; `SECRET_STAGED` would put a secret in history;
`NO_VERIFY` disables all native hooks; and `HOOKSPATH_TAMPER` repoints
`core.hooksPath` away from the guardrails. These remain local defense-in-depth
decisions; required CI and remote rules are the shared authority.

## Threat model

The agent guard and native Git hooks are **best-effort local safeguards**, not
hard security boundaries. They close accidental and obvious bypasses and give
fast feedback, but a process with local control can disable or replace them.
Required CI and GitHub rulesets are the shared enforcement layers. See
[`threat-model.md`](threat-model.md) for the complete model.

## Validation scenarios

These are encoded as assertions in `tools/validation/verify-policy.mjs`; run it to confirm the
contract holds after any change to the engine or config:

- commit/merge on `main`/`dev`/`master` → block, unless override;
- push to a protected branch (including chained `… && git push origin main`) → block;
- `--no-verify` / `git config core.hooksPath …` → block, **even with the override marker**;
- short branch from `main` → block; from `dev` → allow;
- create/switch with dirty worktree → block;
- force-push to a protected branch → block; remote delete of `main` → block;
- force-push / amend / `reset --hard` / rebase of a shared non-protected branch → warn or block per `historyProtection`;
- PR `feat/* -> dev` → allow; `feat/* -> main` → block; no base → block;
- `gh pr merge` / `gh api …/pulls/N/merge` → block without override; write-ish `gh api` (refs/protection/releases) → block;
- staged `.env` or secret pattern on commit → block, **never overridable**;
- tag/`gh release` → warn or block per `tagProtection`; commit on detached HEAD → warn;
- non-Conventional `-m` message → warn or block per `conventionalCommits`; `git worktree` → warn.
- direct edits outside the current worktree → allow; missing/inside targets on a protected branch → block;
- `/dev/null`, `nul` and `$null` redirections → allow, while real file redirections → block on protected branches;
- pushing a short branch to its own remote branch → allow so an open PR can be completed;
- the Stop hook blocks one incomplete closure attempt, then accepts a repeated
  `stop_hook_active` event so the agent can report an external blocker without
  entering an unbounded loop.
