# Agent platforms

## Shared contract

Keep durable repository expectations in `AGENTS.md`. Keep instructions factual, short, and specific to setup, checks, constraints, and completion criteria.

Install the canonical skill under `.agents/skills/configure-project/`.

The explicit `bootstrap` installer installs the global CLI and this skill for
all three supported agents without relying on npm lifecycle scripts. Use
`gitflow-sentinel ai install --all` only to repair or repeat the agent
integration. Existing unmanaged skill directories are never overwritten.

## Codex

Use `.agents/skills` for discovery. Merge Codex hooks or rules structurally and preserve unrelated settings. Require the repository to be trusted, then review and trust every new or changed project-hook hash with `/hooks` before claiming direct-edit enforcement is active.

When the Codex interface offers Plan mode, recommend enabling it before a
configuration request so the structured user-input tool is available for
non-deducible choices. Interfaces and releases may expose this control
differently, so do not make it a hard runtime prerequisite. Without it, ask a
plain-text question and wait.

## Claude Code

Keep `CLAUDE.md` as a minimal adapter to the canonical contract. Mirror the portable skill into `.claude/skills/configure-project/` when native discovery requires it. Merge `.claude/settings.json`; never replace the entire file.

Plan mode is recommended for configuration discovery. Claude Code provides the
built-in `AskUserQuestion` tool for multiple-choice clarification. It is
available by default; if the host restricts the tool allowlist, keep
`AskUserQuestion` in that list.

## OpenCode

Prefer `.agents/skills`, which OpenCode discovers alongside its native directories. Add `opencode.json` only for a real platform-specific permission or agent requirement.

OpenCode's built-in `question` tool provides interactive choices. Ensure its
permission is `allow` or `ask` rather than `deny`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "question": "allow"
  }
}
```

Do not create or rewrite `opencode.json` solely to add this permission when the
tool already works. Preserve unrelated user settings through a structural merge.

## Other agents

Expose the same CLI JSON contracts. Add an adapter only for discovery, permissions, or hook wiring; do not fork planning or policy logic.
