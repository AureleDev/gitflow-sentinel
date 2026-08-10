# Sentinel Core architecture

## Responsibilities

```text
CLI
 ├─ inspection
 ├─ desired-state loading and validation
 ├─ deterministic planner
 ├─ transactional executor
 ├─ verification
 └─ provider adapters
```

The host AI observes the snapshot, explains recommendations and gathers
non-deducible choices. It never owns file mutation logic. Sentinel Core owns
deterministic reads, diffs, hashes, writes, journals, verification and rollback.

## Versioned contracts

- `ProjectSnapshot`: redacted local and provider capabilities.
- `DesiredState`: selected profile, decisions and enabled modules.
- `ChangePlan`: ordered immutable actions, risks, preconditions and rollback
  strategy.
- `TransactionRecord`: attempted actions, backups, results and resume state.

Plan hashes are calculated from canonical JSON with the hash field omitted.
Apply validates the hash, the explicit approval and every precondition.

## Filesystem rules

Writes use a sibling temporary file followed by atomic rename. Paths must stay
inside the project root, may not target `.git`, and may not cross a symbolic
link. Backups and journals live under the actual Git directory:

```text
.git/sentinel/
  transactions/
  backups/
  quality-evidence/
  transaction.lock
```

Greenfield initialization first writes a short-lived bootstrap journal in the
project folder, then migrates it under `.git/sentinel/` as soon as `git init`
exists. This makes initialization resumable at the transaction boundary.

Plans never contain previous file contents or secret values. Before backing up
an existing target, Sentinel scans it for high-confidence secret material and
blocks the mutation if an exact backup would persist a secret. Existing file
mode and timestamps are recorded for rollback; backup and journal files use
owner-only permissions where the platform supports POSIX modes.

## Modules

Each registered module implements
`detect`, `recommend`, `plan`, `apply`, `verify`, `rollback` and `uninstall`.
The transaction engine routes actions and rollback through that registry
instead of accepting arbitrary module/action combinations. V1 modules are Git,
the optional historical local Git policy, GitHub, agents, documentation,
quality, CI, security, dependencies and release preparation. The standard
profile does not install the historical policy runtime.
Interactive setup offers it as an explicit choice and describes it as local
defense in depth, not shared enforcement.

## Local and provider inspection

Project and workspace discovery is recursive but bounded. Generated dependency,
build and agent-worktree directories are excluded. Local inspection never calls
GitHub. Provider inspection is opt-in with `--remote`, has bounded command
timeouts, and is required before planning a remote-state mutation.

On Windows, inspection reports effective Git long-path support. When it is not
already enabled, the Git module plans repository-local `core.longpaths=true`
after initialization so deep project trees remain indexable without changing
the user's global Git configuration.

## Quality evidence

Repository commands are treated as untrusted executable input. `check` first
produces a state-bound R2 hash and runs nothing. After explicit approval, it
uses direct process arguments without a shell, persists no command output, and
records evidence only when the command succeeds without changing the worktree.
CI planning accepts only evidence matching the current commit, branch and
status hash.

## GitHub adapter

GitHub is the only V1 provider. Its mutations are R3. The adapter uses a
dedicated `gitflow-sentinel` ruleset, preserves all unrelated repository
settings, reads back the saved result and returns a failure on any refused
operation.

No source push is part of repository creation. GitLab and MCP can be added
behind the same contracts after the CLI JSON formats stabilize.
