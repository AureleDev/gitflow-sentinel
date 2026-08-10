# Agent platforms

## Shared contract

Keep durable repository expectations in `AGENTS.md`. Keep instructions factual, short, and specific to setup, checks, constraints, and completion criteria.

Install the canonical skill under `.agents/skills/configure-project/`.

The explicit `bootstrap` installer installs the global CLI and this skill for
all three supported agents without relying on npm lifecycle scripts. Use
`gitflow-sentinel ai install --all` only to repair or repeat the agent
integration. Existing unmanaged skill directories are never overwritten.

## Codex

Use `.agents/skills` for discovery. Merge Codex hooks or rules structurally and preserve unrelated settings. Require the repository to be trusted before project configuration can take effect.

## Claude Code

Keep `CLAUDE.md` as a minimal adapter to the canonical contract. Mirror the portable skill into `.claude/skills/configure-project/` when native discovery requires it. Merge `.claude/settings.json`; never replace the entire file.

## OpenCode

Prefer `.agents/skills`, which OpenCode discovers alongside its native directories. Add `opencode.json` only for a real platform-specific permission or agent requirement.

## Other agents

Expose the same CLI JSON contracts. Add an adapter only for discovery, permissions, or hook wiring; do not fork planning or policy logic.
