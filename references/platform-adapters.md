# Platform adapters

The same hook scripts run on Codex and Claude Code. Portability rests on one
fact: both runtimes treat **exit code 2 from a hook as a block and feed the
hook's stderr back to the agent**. So the blocking path needs no per-platform
branches. Only the wiring file and the tool-name matchers differ.

## What is shared

- `.gitflow-sentinel/core/*.mjs` — the engine.
- `.gitflow-sentinel/hooks/{guard,session-start,cycle-reminder}.mjs` — the agent hooks.
- `.gitflow-sentinel.json` — the policy.

`.gitflow-sentinel/hooks/ci-check.mjs` belongs to the **CI** layer, not the agent
layer: it is invoked by the GitHub Actions workflow (reading `GITHUB_BASE_REF` /
`GITHUB_HEAD_REF`) to validate PR routing server-side against the same config, so
server enforcement never drifts from local. It is not an agent PreToolUse hook.

The hooks read the payload from stdin and normalize it (`core/event.mjs`) by
probing every known field path, so Codex's `functions.shell_command` shape and
Claude Code's `tool_input.command` shape both resolve to the same command list.

## Codex wiring — `.codex/hooks.json`

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node .gitflow-sentinel/hooks/session-start.mjs" }] }],
    "PreToolUse": [{ "matcher": "Bash|Shell|exec_command|functions.exec_command|functions.shell_command|apply_patch|functions.apply_patch|multi_tool_use.parallel", "hooks": [{ "type": "command", "command": "node .gitflow-sentinel/hooks/guard.mjs" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node .gitflow-sentinel/hooks/cycle-reminder.mjs" }] }]
  }
}
```

Codex also gets `.codex/rules/git-safety.rules` (execpolicy) as defense-in-depth
for destructive commands that should never run regardless of branch.

### Codex hooks and Windows

Codex CLI's hook system (`SessionStart`/`PreToolUse`/`Stop`, wired via
`.codex/hooks.json`) is, as of this writing, an **experimental, opt-in**
feature — it requires `[features] codex_hooks = true` in `~/.codex/config.toml`
— and is **not available on Windows at all**. Installing `.codex/hooks.json` is
harmless either way (it is inert if Codex never reads it), but it means the
*agent* layer for Codex may simply never fire on a Windows machine, or on any
machine where hooks are not explicitly enabled. `doctor.mjs` warns
(`CODEX_HOOKS_WINDOWS`) when it detects Codex wiring on `process.platform ===
"win32"`, specifically so this isn't a silent gap.

This does **not** weaken the guardrails to nothing: the **native git layer**
(`pre-commit`/`commit-msg`/`pre-push`) does not depend on Codex's hook system
at all — it fires on every `git` invocation regardless of which agent (or
human) is driving it, on every OS. On a Windows/Codex setup, treat the native
layer as the real boundary in practice, the same way it already is for agents
that have no pre-tool wiring at all (see "Adding a new runtime" below).

## Claude Code wiring — `.claude/settings.json`

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node .gitflow-sentinel/hooks/session-start.mjs" }] }],
    "PreToolUse": [{ "matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit", "hooks": [{ "type": "command", "command": "node .gitflow-sentinel/hooks/guard.mjs" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node .gitflow-sentinel/hooks/cycle-reminder.mjs" }] }]
  }
}
```

The installer merges only the `hooks` key, so existing `permissions`, `env`, and
other settings are preserved.

## Matcher differences

| Concern | Codex | Claude Code |
|---------|-------|-------------|
| Shell commands | `functions.shell_command`, `Shell`, `exec_command` | `Bash` |
| Direct file edits | `functions.apply_patch` | `Edit`, `Write`, `MultiEdit`, `NotebookEdit` |
| Batched calls | `multi_tool_use.parallel` | (handled per-tool) |

`core/parser.mjs` recognizes the direct-edit tool names from both runtimes, so
the `DIRECT_EDIT_PROTECTED` guard fires whether the agent edits via Codex's
`apply_patch` or Claude Code's `Edit`/`Write`.

## Native git layer

The agent layers above only fire when an agent uses a tool. The native layer
closes that gap with real git hooks that run on every git operation — human or
tool. They are installed under `.gitflow-sentinel/githooks/` and activated by
pointing `core.hooksPath` there.

This is also what covers the agents that are **not** explicitly wired (Cursor,
Gemini CLI, GitHub Copilot, Aider, Cline, Windsurf, …): the moment any of them
shells out to `git`, the native layer enforces the policy. Only Codex and Claude
Code additionally get the pre-tool (PreToolUse) block; for everyone else the
native git layer is the line of defense.

### Auto-activation after clone

`core.hooksPath` is **local** git config — it is not cloned, so a fresh clone has
no native enforcement until it is re-set. `.gitflow-sentinel/activate.mjs`
re-arms it; the installer wires it into `package.json`'s `"prepare"` script so it
runs on every `npm/pnpm/yarn install` (the same trick husky uses). On a non-Node
repo, run `node .gitflow-sentinel/activate.mjs` once after cloning. If another
hook manager (husky, lefthook) already owns `core.hooksPath`, the installer does
**not** fight for it — it **injects** the gitflow-sentinel call into the existing
`.husky/*` hooks instead, so lint-staged/commitlint keep working alongside.

| Hook | Enforces (via `core/`) | Blocks by |
|------|------------------------|-----------|
| `pre-commit` | no commit on a protected branch; no staged secrets/`.env` | exit 1 |
| `commit-msg` | Conventional Commits (advisory) | prints, exit 0 |
| `pre-push` | no direct push to a protected branch (reads refs on stdin) | exit 1 |

Each hook is a tiny `sh` wrapper that execs `node .gitflow-sentinel/githooks/native.mjs <event>`,
so the same engine and the same `.gitflow-sentinel.json` drive both layers — they
cannot disagree. The override for this layer is an environment variable, e.g.
`GITFLOW_OVERRIDE=explicit git commit …`.

Caveats:
- `core.hooksPath` replaces the default `.git/hooks`. The installer refuses to
  overwrite an existing `core.hooksPath` (Husky, etc.) and prints manual
  integration guidance instead.
- It is local git config, not cloned. Teammates run once after cloning:
  `git config core.hooksPath .gitflow-sentinel/githooks`. The doctor's CHECK 6
  flags when it is unset.

## Adding a new runtime

Wiring a new agent only adds the **pre-tool** block — the native git layer
already covers it the moment it runs `git` (see above). To add the pre-tool
block:

1. Drop a wiring template for the runtime alongside the existing ones, mirroring
   the platform's hooks schema. For an agent that reuses the Claude/Codex hooks
   shape, e.g. **Cursor** under `.cursor/hooks.json`:

   ```json
   {
     "hooks": {
       "SessionStart": [{ "hooks": [{ "type": "command", "command": "node .gitflow-sentinel/hooks/session-start.mjs" }] }],
       "PreToolUse": [{ "matcher": "Bash|Shell|Edit|Write", "hooks": [{ "type": "command", "command": "node .gitflow-sentinel/hooks/guard.mjs" }] }],
       "Stop": [{ "hooks": [{ "type": "command", "command": "node .gitflow-sentinel/hooks/cycle-reminder.mjs" }] }]
     }
   }
   ```

   Set the `matcher` to that runtime's shell- and edit-tool names. `core/event.mjs`
   already probes many payload shapes, so the same `guard.mjs` usually needs no
   changes.
2. If it exposes a new direct-edit tool name, add it to `DIRECT_EDIT_TOOLS` in
   `core/parser.mjs` and to the `verify.mjs` scenarios.
3. Confirm it honors the **exit-code-2** convention (exit 2 = block, stderr fed
   back to the agent). If not, add a small output adapter in the hook
   entrypoints — the only place output format would need to differ.
