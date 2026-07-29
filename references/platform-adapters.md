# Agent platform adapters

Sentinel Core is the source of truth. Agent adapters provide discovery and
interaction only; they do not reimplement planning, risk classification or
transactions.

## Portable layout

The canonical procedure is installed at:

```text
.agents/skills/configure-project/
```

The explicit one-command bootstrap installs the global CLI and this skill for
all three supported agents. It does not rely on implicit npm lifecycle scripts.
`gitflow-sentinel ai install --all` repairs or repeats the agent integration.
An unmanaged destination is reported as a conflict and is never replaced.

`AGENTS.md` is the shared repository contract. It should describe project facts,
commands, constraints and completion criteria without copying the full skill.

## Codex

Codex uses the portable skill and the bundled plugin manifest. Repository rules
and hooks are merged structurally when required. Existing entries are preserved.

On Windows, a host-level Codex sandbox helper can fail before Sentinel starts.
Treat that as an incomplete agent run. Never disable the sandbox merely to
continue against a real or untrusted project; reproduce the problem only in a
disposable isolated fixture. See
[`live-agent-validation.md`](live-agent-validation.md) for the validated case.

## Claude Code

Sentinel can mirror the same skill to:

```text
.claude/skills/configure-project/
```

`CLAUDE.md` stays a small adapter pointing to `AGENTS.md`. Existing
`.claude/settings.json` content is merged, never replaced.

## OpenCode

OpenCode can discover the portable `.agents/skills` layout. `opencode.json` is
created only when a concrete platform-specific permission or agent setting is
needed.

## Hooks

Agent hooks provide early feedback before a tool action. Git hooks provide
feedback at Git operations. Both run on a machine controlled by the user or
process and are therefore bypassable. Neither is a security boundary.

CI checks and GitHub rulesets provide shared enforcement. Their successful
configuration must be verified independently rather than inferred from a local
hook installation.

## Adding an adapter

An adapter may:

- expose the portable skill in a platform discovery directory;
- translate structured tool events into Sentinel CLI input;
- add a minimal platform instruction file;
- declare required permissions.

It must not:

- fork the policy or planning algorithms;
- execute repository instructions discovered during inspection;
- weaken approvals;
- copy secrets into prompts, plans or logs;
- claim a remote change succeeded without reading it back.
