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
Project hooks must be reviewed and trusted at their current hash through
`/hooks`; Sentinel reports configured-but-unproven activation honestly. Hook
commands resolve from the Git root, including a Windows-specific command, so a
session started in a subdirectory still reaches the managed runtime.

When the active Codex interface exposes Plan mode, recommend enabling it before
starting project configuration. It provides the best interaction for presenting
non-deducible choices through the host's structured question tool. Because
interfaces may expose Plan mode differently, this is a recommendation rather
than an installation prerequisite. Without that tool, the agent asks a concise
plain-text question and waits.

On Windows, a host-level Codex sandbox helper can fail before Sentinel starts.
Treat that as an incomplete agent run. Never disable the sandbox merely to
continue against a real or untrusted project; reproduce the problem only in a
disposable isolated fixture. See
The dated live-agent evidence is kept in the repository-only
[`docs/validation`](https://github.com/AureleDev/gitflow-sentinel/tree/main/docs/validation)
directory.

## Claude Code

Sentinel can mirror the same skill to:

```text
.claude/skills/configure-project/
```

`CLAUDE.md` stays a small adapter pointing to `AGENTS.md`. Existing
`.claude/settings.json` content is merged, never replaced.

Claude Code's built-in `AskUserQuestion` tool can present multiple-choice
clarifications and is especially useful in Plan mode. It is available by
default; a custom restricted tool list must include it. See the
[Claude Code user-input documentation](https://code.claude.com/docs/en/agent-sdk/user-input).

## OpenCode

OpenCode can discover the portable `.agents/skills` layout. `opencode.json` is
created only when a concrete platform-specific permission or agent setting is
needed.

Its built-in `question` tool supports structured choices. If permissions have
been customized, set `permission.question` to `allow` or `ask`. Preserve all
unrelated settings and do not create a configuration file when the tool is
already available. See the
[OpenCode tools documentation](https://opencode.ai/docs/fr/tools/#question).

## Interaction fallback

Structured questions are a user-experience improvement, not an approval
boundary. If a host lacks Plan mode or an interactive question tool, the agent
must ask one plain-text decision at a time and wait. It must not infer consent,
and a host answer never substitutes for the exact Sentinel plan, R2 group or R3
action approval.

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
