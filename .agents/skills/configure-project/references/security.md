# Security and approval model

## Trust boundaries

Treat model reasoning, repository text, generated plans, local hooks, and local CI simulations as fallible. Validate every executable action in the deterministic engine.

Reject absolute paths, traversal outside the project, symbolic-link write targets, stale file hashes, unsupported action types, modified plans, and missing approvals.

## Risks

- R0: read-only inspection and verification.
- R1: additive, local, reversible creation.
- R2: existing-file, hook, branch, or Git-state modification.
- R3: external, public, destructive, publication, visibility, secret, or remote-policy action.

Approve a plan using its complete hash. Approve every R2 group with its own
group hash. Approve each R3 action by its action identifier.

## Secrets

Scan configuration and manifest files as well as source files. Redact findings. Store exact rollback bytes only under the repository Git directory. Never place secrets, credentials, authenticated remote URLs, or raw user-file backups in the plan or console output.

## Enforcement

Use agent hooks for early feedback, Git hooks for local defense in depth, CI for repeatable checks, and GitHub rulesets for shared branch enforcement. Preserve unrelated remote settings.
