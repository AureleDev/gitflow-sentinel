# Contributing to {{PROJECT_NAME}}

This project uses **gitflow-sentinel** to keep Git and GitHub work safe and
predictable. The branch model lives in [`.gitflow-sentinel.json`](.gitflow-sentinel.json);
edit that file to change the policy rather than editing hooks.

## Branch model

```text
{{SHORT_PREFIXES}} / *   ->  {{INTEGRATION_BRANCH}}   (via PR)
{{INTEGRATION_BRANCH}}   ->  {{STABLE_BRANCH}}        (validated milestones, via PR)
hotfix/*                 ->  {{INTEGRATION_BRANCH}} or {{STABLE_BRANCH}}, with approval
release/*                ->  {{STABLE_BRANCH}}, for milestone promotion
```

- **`{{STABLE_BRANCH}}`** is stable. No direct work, no direct commits or pushes.
- **`{{INTEGRATION_BRANCH}}`** is the integration branch. No direct feature work;
  it collects PRs.
- **Short branches** start from a clean, up-to-date `{{INTEGRATION_BRANCH}}` and
  target `{{INTEGRATION_BRANCH}}`.
- **`{{LEGACY_BRANCH}}`** is treated as a legacy stable branch and must be
  normalized to `{{STABLE_BRANCH}}`/`{{INTEGRATION_BRANCH}}` before work begins.

## The cycle

1. Start clean: `git switch {{INTEGRATION_BRANCH}} && git pull --ff-only`.
2. Create a short branch: `git switch -c feat/<topic>`.
3. Work, then commit with a [Conventional Commit](https://www.conventionalcommits.org)
   message: `feat(scope): summary`.
4. Push with upstream: `git push -u origin feat/<topic>`.
5. Open a PR to `{{INTEGRATION_BRANCH}}`: `gh pr create --base {{INTEGRATION_BRANCH}}`.
6. After approval, merge, then sync: `git fetch --prune && git switch {{INTEGRATION_BRANCH}} && git pull --ff-only`.

## After cloning

The native git hooks are activated through `core.hooksPath`, which git does not
clone. On a Node project this is re-armed automatically by the `prepare` script
on `npm/pnpm/yarn install`. Otherwise, run this once after cloning:

```bash
node .gitflow-sentinel/activate.mjs
```

## What the guardrails enforce

Two local layers share one engine. The **native git hooks** (`pre-commit`,
`commit-msg`, `pre-push`) run on ordinary Git commands but remain locally
bypassable. The **agent layer** hook in `.gitflow-sentinel/hooks/guard.mjs` blocks
(exit code 2, with an explanation fed back to the agent) when a coding agent
acts:

- commits, merges, resets, or file writes on a protected branch;
- short branches created from anywhere but `{{INTEGRATION_BRANCH}}`, or with a
  dirty worktree;
- branch switches with a dirty worktree;
- direct pushes, force-pushes, or remote deletion of a protected branch;
- PRs with no base, to `{{LEGACY_BRANCH}}`, or with a head/base route that is not
  allowed;
- `gh pr merge` / API merges without a recorded approval, and write-ish
  `gh api` calls (ref/protection/release changes);
- commits that stage secrets or `.env*` files;
- `--no-verify` and `core.hooksPath` changes (these disable the guardrails and
  are blocked unconditionally).

It also reminds (without blocking) about non-Conventional commit messages,
tag/release operations, history rewrites on shared branches, worktree isolation,
branch deletion, detached HEAD, and missing upstreams. These advisory severities
are configurable in `.gitflow-sentinel.json`.

## Sanctioned exceptions

When an exceptional operation is genuinely needed, record the decision in the
command so it shows up in history:

```bash
git push origin {{INTEGRATION_BRANCH}}   # {{OVERRIDE_MARKER}}: reason for the exception
```

The override sanctions one routine action. It can never let a secret through, nor
re-enable `--no-verify` or a `core.hooksPath` change.

## Worktrees

Worktrees are allowed for parallel tasks, but keep them isolated under the
configured `worktreeRoot` and remove them when done. Never make a worktree the
principal checkout.
