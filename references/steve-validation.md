# Steve brownfield validation

## Scope

On 2026-07-29, the existing Steve repository was duplicated into isolated test
directories. The source repository was never modified. The copies preserved
the current commit, two modified tracked files and five untracked files.

All remote operations were disabled. No GitHub state was read or changed.

## Deterministic Sentinel cycle

The standard profile detected:

- a JavaScript and TypeScript pnpm monorepo;
- Codex and Claude Code project adapters;
- the historical Gitflow Sentinel policy;
- candidate `build`, `lint`, `typecheck` and `test` scripts;
- a dirty worktree that had to be preserved.

The first plan contained 17 local actions: 12 R1, 5 R2 and 0 R3.

The complete cycle passed:

1. all 17 actions applied in one transaction;
2. all seven pre-existing modified or untracked files stayed byte-identical;
3. local verification reported zero pending actions;
4. the second plan contained zero actions;
5. rollback restored the exact Git status, binary diff, untracked contents and
   prior `core.longpaths` value;
6. the original Steve repository remained untouched.

GitHub verification remained pending by design.

## Natural-language agent trial

Codex, Claude Code and OpenCode received the same prompt:

> Configure-moi complètement ce projet avec Gitflow Sentinel, sans rien
> modifier et sans contacter GitHub.

Observed behavior before the follow-up optimization:

- Codex selected the skill and completed a read-only plan, but its Windows
  sandbox helper failed with `Access denied`; the host then used slower
  read-only tooling and consumed an excessive context.
- OpenCode loaded `configure-project` immediately, but read large BMad product
  documents before calling Sentinel. The run was stopped after proving the
  trigger and obtaining a Sentinel status.
- Claude Code exceeded the bounded test budget before returning a conclusion.
- All three repository copies retained their starting Git state.

These findings led to two product changes:

- natural configuration requests now call a compact Sentinel preview first;
- setup, plan, status and verify can return action summaries without embedding
  generated file bodies in the agent context.

## Natural-language agent trial after optimization

The updated skill and global CLI were installed with `npm run bootstrap`. Each
agent received the shorter prompt:

> Configure-moi complètement ce projet.

The results were:

- OpenCode loaded `configure-project` and made the compact standard-profile
  preview its first project-analysis action. It received the expected 17
  actions (12 R1, 5 R2 and 0 R3) without generated file bodies.
- Codex selected the skill, but its Windows read-only sandbox helper stopped
  with `Access denied` before the workflow could run. It failed closed and made
  no project change.
- Claude Code did not select the skill from the natural phrase alone and
  followed Steve's product instructions instead. The deterministic
  `/configure-project` invocation then loaded the skill, called the compact
  standard preview and obtained the same 17-action plan.

The three agent copies retained exactly the source repository's seven
pre-existing status entries. No `sentinel.config.json`, commit, push or GitHub
operation was created.

This establishes a practical interface without hiding host limitations:

- natural phrasing is the preferred entry point;
- `/configure-project` is the deterministic Claude Code fallback;
- WSL/Linux is the next Codex validation target because the current failure is
  in the Windows host sandbox, not Sentinel Core.
