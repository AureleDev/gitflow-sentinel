# Claude Code guide for {{PROJECT_NAME}}

This repository is protected by **gitflow-sentinel**. The same branch model and
guardrails described in [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md)
apply to you.

Key points:

- Do not commit, merge, push, or edit files directly on `{{STABLE_BRANCH}}`,
  `{{INTEGRATION_BRANCH}}`, or `{{LEGACY_BRANCH}}`. Work on a short branch
  (`{{SHORT_PREFIXES}}` / …) cut from a clean `{{INTEGRATION_BRANCH}}`.
- Use Conventional Commit messages and never stage secrets or `.env*` files.
- Never bypass the hooks with `--no-verify` or by changing `core.hooksPath` —
  both are blocked and cannot be overridden.
- Close short branches properly: push, PR to `{{INTEGRATION_BRANCH}}`, decision,
  post-merge sync.
- The PreToolUse/Stop hooks in `.gitflow-sentinel/hooks/` will block unsafe
  actions via exit code 2 and feed the reason back to you — read it and correct
  course rather than working around it.
- Record sanctioned exceptions inline: `# {{OVERRIDE_MARKER}}: reason`.
