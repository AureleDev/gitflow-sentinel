# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [3.0.0-alpha.1] — 2026-07-27

### Added

- An explicit one-command bootstrap now installs both the global CLI and the
  portable agent skill without relying on implicit npm lifecycle scripts.
- Claude Code now has a documented deterministic `/configure-project`
  fallback; natural skill selection is no longer presented as guaranteed by
  every host model.
- Compact JSON review surfaces for setup and plans, plus compact status and
  verification actions that omit generated file bodies.
- CLI `--version` support.
- Visual atlas covering the product architecture, human and agent journeys,
  project lifecycle, transaction safety, supported agents and the role of WSL.
- Guided `gitflow-sentinel setup` flow for inspect, explain, approve, apply and
  immediate local verification in one command.
- One-time `gitflow-sentinel ai install` skill distribution for Codex, Claude
  Code and OpenCode, with idempotent updates and unmanaged-conflict refusal.
- Python project detection from bounded source-file signals when no package
  manifest exists.
- Sentinel Core contracts, redacted project inspection and deterministic
  desired-state planning.
- Bounded recursive workspace detection for nested TypeScript, Python `uv`,
  package managers and monorepos, excluding generated agent worktrees.
- Local-only inspection by default with explicit `--remote`/`--offline`
  provider modes and bounded provider command timeouts.
- Immutable plan hashes, stale-plan preconditions, atomic local transactions,
  exact-byte backups, resume and rollback.
- Inter-process transaction locks, greenfield bootstrap journals, file metadata
  restoration and secret-safe backup refusal.
- Windows long-path detection and repository-local configuration, plus exact
  preservation of pre-existing empty parent directories during rollback.
- State-bound, explicitly approved quality checks whose output is never stored;
  CI generation now requires current verification evidence.
- Executable module lifecycle registry for planning, application, verification,
  rollback and uninstall boundaries.
- Public `inspect`, `init`, `plan`, `apply`, `verify`, `status`, `rollback`,
  `resume` and `update` commands.
- Foundation modules for Git, GitHub, agent guidance, documentation, quality,
  CI, security, dependencies and release preparation.
- Portable `configure-project` Agent Skill and Codex plugin packaging.
- Greenfield, brownfield, idempotence, stale-state and rollback integration
  coverage.

### Changed

- Internal validation programs now live under `tools/validation/`, while dated
  execution evidence lives under repository-only `docs/validation/`.
- The npm package now includes an explicit runtime surface and excludes tests,
  eval cases, validation tools and machine-specific evidence.
- The portable skill now routes natural configuration requests directly to a
  bounded Sentinel preview before broad project-document discovery.
- The standard profile now keeps the historical local Git-policy runtime
  optional; it remains available through `hardened` or a custom profile.
- Existing agent directories are selected automatically when no explicit agent
  list is supplied.
- Git policy is now one module in a general project-foundation orchestrator.
- GitHub protection uses a dedicated additive ruleset and verifies the result.
- Invalid configuration fails closed and is never replaced automatically.
- Local agent and Git hooks are documented accurately as defense in depth.

### Fixed

- Approved npm quality commands now execute through Windows `.cmd` shims
  without enabling a general shell or allowing argument metacharacter injection.
- Direct-edit policy now evaluates resolved target paths and ignores writes
  outside the current worktree instead of blocking solely on the tool name.
- Direct-edit messages no longer advertise an unreachable override channel.
- Shell-write detection uses parsed command positions, exempts `/dev/null`,
  `nul` and `$null`, and no longer treats writer names inside arguments as writes.
- Claude Code hook wiring now matches every tool so a newly added shell cannot
  silently bypass the guard.
- The Stop hook is advisory and cannot trap an agent in an unbounded loop.
- Runtime and package versions are aligned, with SessionStart drift reporting.
- A root `package.json` without a lockfile now defaults to npm, while an
  explicit `packageManager` field remains authoritative; npm Dependabot is no
  longer omitted from such projects.
- Managed blocks in `.gitignore` and `.gitattributes` use valid `#` comments
  and migrate prior HTML markers without creating duplicates.
- Guided setup distinguishes locally compliant foundations from GitHub state
  that was not queried.

### Security

- Plans exclude prior file contents and secret values.
- Paths, symbolic links, approvals and local/remote preconditions are checked
  before mutation.
- Unknown pull-request routes and global `gh --repo … pr merge` forms fail
  safely.

## [2.1.0] — 2026-07-26

Windows-compatibility and coexistence-with-the-past hardening pass, plus
installer/CLI ergonomics. No config schema changes.

### Added
- **Windows shell re-analysis**: `cmd.exe` (`/c`, `/k`) and PowerShell
  (`-Command`, `-c`) are now recognized shell wrappers, so `powershell -Command
  "git push origin main"` / `cmd /c "..."` are re-analyzed the same way `sh -c
  "..."` always was.
- **Legacy-generation detection** (`doctor.mjs`): flags an earlier
  `gitflow-sentinel`/`git-project-guardrails` generation (per-project
  copy-pasted hooks, no shared runtime) so it is never silently installed
  alongside the current one — see `references/migration.md` for the cleanup
  steps this points to.
- **Codex-hooks-on-Windows advisory** (`doctor.mjs`): warns when `.codex/hooks.json`
  is wired on `win32`, where Codex's hook system is experimental, opt-in, and
  not available at all as of this writing — see
  `references/platform-adapters.md#codex-hooks-and-windows`.
- **Unified CLI** (`scripts/cli.mjs`, `package.json` `bin`): `gitflow-sentinel
  <doctor|install|verify|uninstall|orchestrate|github-protect>` once installed,
  instead of needing this repo's absolute path.
- `evals/evals.json` is now shipped in the published package (`files`) and has
  a structural validator (`npm run validate:evals` /
  `tools/validation/validate-evals.mjs`).
- `README.md`: explicit "installing as a skill" steps and a migration pointer;
  `references/migration.md` is new.

### Changed
- `runCommitlint` (`core/external.mjs`) spawns through a shell on Windows
  (`shell: true`) — `execFileSync` cannot invoke a `.cmd`/`.bat` shim directly
  on Windows regardless of what it is named, which previously made commitlint
  delegation fail with `EINVAL` on every commit whenever a commitlint config
  file was present, blocking commits outright in `conventionalCommits:
  "block"` mode.
- The sanctioned-override message (`core/policy.mjs`) now tells the agent to
  run the command as `GITFLOW_OVERRIDE=explicit <command>` (an env-var prefix)
  instead of "append a comment `# GITFLOW_OVERRIDE=explicit: reason`" — a
  trailing shell comment satisfies the agent-layer text match but is stripped
  before the real command runs, so it never satisfies the native git hook's
  env-var check, producing a confusing pass-then-block.
- `core/event.mjs`'s `cwd()` now also reads a flat (non-nested) payload's
  `parameters.workdir`/`arguments.workdir`, matching the lookup breadth
  `commandFrom()` already had for `command` — a payload shaped like
  `{ recipient_name, parameters: { command, workdir } }` previously fell back
  to `process.cwd()` instead of the workdir it actually carried.
- `guard.mjs` (agent PreToolUse hook) now skips the git-state read entirely for
  tool calls that cannot trigger any rule (no git/gh subcommand, no raw
  shell file-write pattern, not a direct-edit tool) — this is most tool calls
  in a session, and the git-state read was previously unconditional on every
  one of them.
- `core/git.mjs`'s `readState()` merges what were two separate `git status`
  calls into one (`--porcelain --branch`) and no longer computes
  `branchNames`/`branches`, which nothing in the runtime read.
- `install.mjs`'s `classify()` treats a `.claude/`-group template the same way
  as `.codex/` (only the exact wiring-file path is JSON; anything else is a
  plain managed file) — previously any non-JSON file added under
  `assets/templates/claude/` would have been force-parsed as JSON and crashed
  the installer.
- Every script's `--project-root` is validated up front (`resolveProjectRoot`)
  with a clear "not a directory" error, and every flag value is validated so a
  missing/flag-like value (e.g. `--project-root --apply`) errors immediately
  instead of silently swallowing the next flag.
- `verify.mjs`'s syntax checks run concurrently instead of spawning Node once
  per file in series; its installed-project doctor re-check can skip the
  git-branch/sync spawns doctor already ran seconds earlier in the same
  `orchestrate` run (`--skip-git-readiness`, used automatically by
  `orchestrate.mjs --apply`).
- `github-protect.mjs` distinguishes "gh not found" (ENOENT) from "gh found but
  failed to run" instead of reporting both as "gh CLI not found".

### Fixed
- `detectScanners()` no longer computes an unused `git-secrets` presence check.
- `install.mjs` no longer queries `core.hooksPath` twice per apply.
- `lib.mjs`'s `gitReadiness()` no longer calls `git branch --show-current`
  twice for the same value.
- `verify.mjs` now adds direct coverage of `core/event.mjs`
  (`parseInput`/`toolName`/`commands`/`cwd`) against Codex- and
  Claude-Code-shaped payloads — previously only `analyze()`/`evaluate()` were
  exercised, so a regression in the Codex/Claude payload-parity layer itself
  would not have failed any test.
- `verify.mjs --help` now prints usage instead of silently running the full
  suite.
- The GitHub Actions workflow no longer re-triggers on a PR title/body edit
  (`edited` removed from `pull_request.types`).

## [2.0.0] — 2026-06-27

Major hardening and open-source release. **Breaking**: some config fields changed
shape (see *Changed*), and the runtime version bumped to 2.0.0.

### Added
- **History-rewrite protection**: blocks force-push and remote deletion of
  protected branches (`FORCE_PUSH_PROTECTED`, `PROTECTED_DELETE`); warns on
  force-push / amend / reset / rebase of already-published shared branches
  (`FORCE_PUSH_SHARED`, `REWRITE_SHARED`), configurable via `historyProtection`.
- **Bypass protection**: `--no-verify` and `core.hooksPath` changes are blocked
  unconditionally (`NO_VERIFY`, `HOOKSPATH_TAMPER`) — they would otherwise disable
  the guardrails. Not even the override marker bypasses them.
- **Tag & release governance** (`TAG_OP`, `RELEASE_OP`) and dangerous `gh api`
  write detection (`GH_API_WRITE`), plus a `DETACHED_HEAD` advisory.
- **Auto-activation after clone**: `activate.mjs` + a wired package.json `prepare`
  step re-arm `core.hooksPath` on install, so fresh clones are protected without a
  manual step (the piece husky used to be needed for).
- **Hook-manager coexistence**: detects husky and injects into existing
  `.husky/*` hooks instead of clobbering `core.hooksPath`; prints integration
  guidance for lefthook / pre-commit.
- **External scanner delegation** (`delegateScanners`): defers to gitleaks /
  git-secrets for secrets and commitlint for commit messages when present.
- **Server-side GitHub branch protection** via `scripts/github-protect.mjs`
  (`--github-protection`).
- **Clean uninstall** via `scripts/uninstall.mjs`.
- `.gitattributes` snippet pinning hook scripts to LF (CRLF-safe on every OS);
  Node-version check in `doctor`; transactional install with rollback on failure.
- Open-source packaging: `LICENSE` (MIT), `README.md`, this changelog,
  `package.json`.

### Changed
- Stronger command parser: normalizes the git binary path (`/usr/bin/git`,
  `git.exe`), and re-analyzes `sh -c` / `eval` / command substitution / `ssh`
  remote commands so those no longer slip past the agent guard.
- Secret detection expanded (JWT, `github_pat_`, GitLab/Stripe/OpenAI/SendGrid/npm
  tokens, DB connection URIs, more key-file names) with an entropy check, and
  **findings are now redacted** — the raw secret is never printed.
- `conventionalCommits`, `historyProtection`, `tagProtection` are tri-state
  (`off` | `warn` | `block`); booleans still accepted for `conventionalCommits`.
- The override marker is matched only in command text (no more self-poisoning from
  file content), and can never bypass the secrets / bypass-protection rules.
- `pre-push` now fails **closed** if it cannot read the pushed refs; an invalid
  config is reported loudly instead of silently falling back to defaults.
- Project-facing templates use branch placeholders, so they no longer hard-code
  `dev`/`main` in trunk-based or renamed-branch setups.

### Fixed
- `worktreeRoot` default no longer renders as `undefined`.
- Consistent unknown-argument handling across all scripts.
- Documentation drift: every config field and rule code is now documented; the
  Codex matcher in docs matches the shipped wiring; `ci-check.mjs` is correctly
  described as the CI layer.

## [1.x]

Initial generations: one engine, agent + native layers, config-driven branch /
PR / secret / Conventional-Commit policy for Codex and Claude Code.
