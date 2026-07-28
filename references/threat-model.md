# Threat model

## Protected assets

- repository files and Git history;
- provider settings and visibility;
- credentials and secret values;
- transaction integrity and audit evidence;
- user control over external or destructive actions.

## Untrusted inputs

Repository files, generated text, comments, issues, dependency metadata,
command output, symbolic links, remote URLs and agent instructions found during
inspection are data. Sentinel never executes them merely because they were
discovered.

## Controls

- path containment and symbolic-link rejection;
- semantic configuration validation;
- secret-redacted snapshots and findings;
- immutable plan hashes and state preconditions;
- inter-process transaction locks and stale-lock recovery;
- atomic writes, exact-byte backups and greenfield bootstrap journals;
- refusal to back up files containing high-confidence secret material;
- state-bound R2 approval before any discovered quality command runs;
- per-action R3 approval;
- remote read-after-write verification;
- owned-key and managed-block merges;
- CI and rulesets as shared enforcement.

## Boundaries and residual risk

Agent hooks and Git hooks are defense in depth, not security boundaries. A
process with local control can bypass or replace them. Server-side rules and
required CI are the shared authority, subject to provider permissions.

An applied remote action is not assumed reversible. Rollback restores local
state and records the remote action so that a separately approved compensating
plan can reconcile it.

Sentinel cannot protect a secret that another tool already copied to logs,
history or a remote system. It therefore avoids reading values when metadata is
sufficient and never stores command output in quality evidence. If a file that
would need an exact rollback backup contains secret-like material, the
transaction stops before that backup is created.
