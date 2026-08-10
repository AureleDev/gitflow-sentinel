# Claude Code guide for {{PROJECT_NAME}}

This repository is protected by **gitflow-sentinel**. The same branch model and
guardrails described in [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md)
apply to you.

Key points:

- Do not commit, merge, push, or edit files directly on `{{STABLE_BRANCH}}`,
  `{{INTEGRATION_BRANCH}}`, or `{{LEGACY_BRANCH}}`. Work on a short branch
  (`{{SHORT_PREFIXES}}` / …) cut from a clean `{{INTEGRATION_BRANCH}}`.
- Use Conventional Commit messages and never stage secrets or `.env*` files.
- Never bypass the hooks with `--no-verify` or by changing `core.hooksPath`.
  Sentinel rejects those actions locally, while required CI and remote rules
  remain the shared enforcement authority.
- Close short branches properly: push, PR to `{{INTEGRATION_BRANCH}}`, decision,
  post-merge sync.
- The PreToolUse hook in `.gitflow-sentinel/hooks/` rejects unsafe operations
  with exit code 2. The Stop hook is advisory and cannot trap the session.
  Both are local defense in depth, not security boundaries.
- For command rules that explicitly support an exception, record the sanctioned
  reason inline: `# {{OVERRIDE_MARKER}}: reason`. Direct file edits on a
  protected branch have no portable override channel; use a short branch.
