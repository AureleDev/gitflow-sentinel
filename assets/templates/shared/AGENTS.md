# Agent guide for {{PROJECT_NAME}}

This repository is protected by **gitflow-sentinel**. Hooks will block unsafe
Git/GitHub actions and explain why, but you should follow the model proactively
rather than relying on the block.

## Before you touch anything

- Read the current branch. If it is `{{STABLE_BRANCH}}`, `{{INTEGRATION_BRANCH}}`,
  or `{{LEGACY_BRANCH}}`, do **not** edit files or commit there. Switch to
  `{{INTEGRATION_BRANCH}}`, pull `--ff-only`, and create a short branch
  (`{{SHORT_PREFIXES}}` / …).
- Keep the worktree clean before switching or creating branches.

## Working

- One short branch per unit of work, started from a clean, up-to-date
  `{{INTEGRATION_BRANCH}}`.
- Conventional Commit messages: `type(scope): summary`.
- Never stage secrets or `.env*` files (use `.env.example` for placeholders).
- Do not use `--no-verify` or change `core.hooksPath` — those disable the
  guardrails and are blocked outright (not even the override marker bypasses
  them).

## Closing the loop

A short branch is not "done" after a local commit. Closure means: pushed with an
upstream, a PR open against `{{INTEGRATION_BRANCH}}`, an explicit
merge-or-keep-open decision, and — after an approved merge —
`{{INTEGRATION_BRANCH}}` synced locally with `git pull --ff-only`.

## Policy and exceptions

- The full policy and the cycle are in [CONTRIBUTING.md](CONTRIBUTING.md).
- The machine-readable model is in [`.gitflow-sentinel.json`](.gitflow-sentinel.json).
- For a genuinely needed exception, record it in the command:
  `# {{OVERRIDE_MARKER}}: reason`. (Secrets and hook-bypass attempts can never be
  overridden.)
