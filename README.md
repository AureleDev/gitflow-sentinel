# gitflow-sentinel

> Branch-policy guardrails that **block** unsafe Git/GitHub actions with an
> explanation — for humans, scripts, and AI coding agents alike. One config, two
> local enforcement layers, and optional server-side protection.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)
![Zero dependencies](https://img.shields.io/badge/deps-0-success.svg)

Most teams write their branching rules in a `CONTRIBUTING.md` and hope everyone
follows them. gitflow-sentinel turns those rules into **enforced policy**: a
direct commit to `main`, a force-push to a protected branch, a staged `.env`, or
an agent trying `git commit --no-verify` is stopped with a clear reason instead
of merely discouraged.

## Why

- **For AI agents.** When Codex or Claude Code drive git, a `PreToolUse` hook
  intercepts dangerous commands *before* they run and feeds the reason back so the
  agent self-corrects. No other hook manager does this.
- **For everyone.** Real `pre-commit` / `commit-msg` / `pre-push` hooks enforce on
  every `git` invocation — typed by a human, a script, any tool — so the rules
  hold even when no agent is involved.
- **At the server.** Optionally configure GitHub branch protection so the rules
  hold no matter what anyone's local machine looks like.

It is **framework-agnostic** (works on any repo — Node, Python, Go, Rust…) and
**zero-dependency**.

## The three layers

| Layer | Fires on | Strength |
|-------|----------|----------|
| Agent (`.codex/hooks.json` / `.claude/settings.json`) | Codex/Claude tool calls | Best-effort nudge; closes accidental & obvious bypasses |
| Native git (`core.hooksPath`) | **Any** git command | The real local boundary |
| Server (GitHub branch protection) | Pushes reaching GitHub | Holds regardless of local setup |

## Installing gitflow-sentinel as a skill

This repository is itself structured as a Claude Code / Codex **skill**
(`SKILL.md` at the root, per each runtime's skill-discovery convention):

- **Claude Code**: copy or clone this repository into your personal skills
  directory, `~/.claude/skills/gitflow-sentinel/` (Windows:
  `%USERPROFILE%\.claude\skills\gitflow-sentinel\`), or into a project's
  `.claude/skills/gitflow-sentinel/` to scope it to that project. Restart the
  session; the agent will discover it from `SKILL.md`'s description.
- **Codex**: same idea, under `~/.codex/skills/gitflow-sentinel/`
  (`%USERPROFILE%\.codex\skills\gitflow-sentinel\` on Windows).

Once installed as a skill, just ask your agent to "set up branch protection"
or "audit our git setup" — the description in `SKILL.md` is written to match on
those and related phrasings. The agent then runs the scripts below itself.

## Install (direct / CLI use)

Whether or not it's registered as a skill, every command below also works by
hand or from your own scripts.

**Unified CLI** (after `npm link` in a clone, or once installed as a package):

```bash
gitflow-sentinel orchestrate --project-root /path/to/your/repo --dry-run   # preview
gitflow-sentinel orchestrate --project-root /path/to/your/repo --apply     # install
gitflow-sentinel doctor      --project-root /path/to/your/repo            # read-only audit
gitflow-sentinel verify      --project-root /path/to/your/repo            # behavioral self-test
```

**Or run the scripts directly from a clone** (no install step, but you need
this repo's own path):

```bash
node scripts/orchestrate.mjs --project-root /path/to/your/repo --dry-run   # preview
node scripts/orchestrate.mjs --project-root /path/to/your/repo --apply     # install

node scripts/doctor.mjs   --project-root <repo>                 # read-only audit
node scripts/install.mjs  --project-root <repo> --apply --platform both
node scripts/install.mjs  --project-root <repo> --apply --github-protection   # + server-side
node scripts/verify.mjs   --project-root <repo>                 # behavioral self-test
```

**Requirements:** Node ≥ 18 on PATH for whoever runs git in the repo (the hooks
run via Node). `gh` (authenticated) only for `--github-protection`.

**Already running an earlier per-project version of this** (a
`gitflow-sentinel` v1.x, or its `git-project-guardrails` fork/rename, copied
project by project before this shared skill existed)? Run `doctor` first — it
detects that generation and flags it — then see
[references/migration.md](references/migration.md) before installing on top.

**On Windows**, Codex CLI's own hooks are experimental, opt-in, and not
available at all as of this writing — see
[references/platform-adapters.md](references/platform-adapters.md#codex-hooks-and-windows)
for what that means for the agent layer there (the native git layer is
unaffected).

## What it enforces (defaults)

- No direct commits / pushes / file edits on `main` or `dev`.
- No force-push or remote deletion of a protected branch.
- Short branches start from a clean `dev`; PRs follow allowed head→base routes.
- No staged secrets or `.env*` files (built-in scanner; defers to **gitleaks** /
  **git-secrets** when present).
- No `--no-verify` and no `core.hooksPath` tampering — these would disable the
  guardrails, so they are blocked unconditionally.
- Conventional Commits (warn by default; defers to **commitlint** when present).

Every rule is data-driven via [`.gitflow-sentinel.json`](assets/templates/shared/.gitflow-sentinel.json)
— git-flow, trunk-based, and monorepo models are all just config. See
[references/configuration.md](references/configuration.md).

## Coexists with (or replaces) husky

If husky already owns `core.hooksPath`, the installer **injects** itself into your
existing `.husky/*` hooks instead of fighting over the path — your lint-staged /
commitlint setup keeps working. It can also fully replace husky: its native layer
already re-arms `core.hooksPath` on a fresh clone (via a `prepare` step), which is
husky's main job.

## Uninstall

```bash
node scripts/uninstall.mjs --project-root <repo> --apply
```

Restores the previous `core.hooksPath`, de-merges the agent wirings, and removes
the runtime.

## Security model

The agent layer is a **smart-assistant guard**, not a hard security boundary — a
determined process can bypass any local pre-tool hook. It deliberately closes the
*accidental* and *obvious* bypasses (path to the git binary, `sh -c`, `eval`,
command substitution, `ssh host …`). The **native git layer** is the real local
boundary, and **server-side branch protection** is the boundary that holds for
everyone. See [references/policy.md](references/policy.md) for the full threat
model.

## License & author

[MIT](LICENSE) © 2026 Aurele Gnonlonfoun ([@AureleDev](https://github.com/AureleDev)).

Contributions welcome — see [CHANGELOG.md](CHANGELOG.md) for the release history.
