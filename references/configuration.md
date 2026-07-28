# Desired state configuration

The V3 declaration is `sentinel.config.json`. It is validated before planning by
[`assets/sentinel/schema.json`](../assets/sentinel/schema.json) and by semantic
checks in the runtime.

An invalid or unreadable configuration is never replaced automatically. Sentinel
reports the errors and preserves the original bytes.

## Top-level contract

```json
{
  "kind": "gitflow-sentinel/desired-state",
  "schemaVersion": 1,
  "profile": "standard",
  "project": {
    "name": "example",
    "visibility": "private",
    "description": "",
    "license": "MIT"
  },
  "vcs": {
    "provider": "github",
    "strategy": "trunk",
    "stableBranch": "main",
    "integrationBranch": "main",
    "legacyBranch": "master",
    "protectedBranches": ["main"]
  },
  "agents": {
    "enabled": ["codex", "claude", "opencode"]
  },
  "github": {
    "createRepository": false,
    "owner": "",
    "reviewers": 1,
    "manageRuleset": true
  },
  "quality": {
    "verifiedCommands": ["npm test"]
  },
  "modules": {
    "enabled": [
      "git", "github", "agents", "docs", "quality",
      "ci", "security", "dependencies", "release"
    ]
  }
}
```

## Profiles

- `minimal`: Git, agent instructions and essential security.
- `standard`: the default foundation set.
- `hardened`: stronger remote review and code-scanning controls.
- `custom`: only explicitly enabled modules.

V1 custom profiles must include `git`, because approved transaction journals
and backups are stored in the repository's actual Git directory.

Detected tools are reused. Selecting a profile never authorizes Sentinel to add
a new formatter, linter, package manager, paid service or deployment provider.

`quality.verifiedCommands` is declarative, not an instruction to execute.
Before a command can be copied into generated CI, run the two-step
`gitflow-sentinel check` preview and approval flow. Evidence becomes invalid as
soon as the commit, branch or worktree changes.

## Project decisions

`project.visibility` may be `private`, `public` or `internal`. Creating a remote
or changing visibility is always R3 and requires a separate approval.

`git.strategy` may be `trunk`, `git-flow` or `detect`. Ambiguity produces a
recommendation; it never silently forces a branch model.

## Ownership

Managed text is delimited by Sentinel markers. Structured JSON is merged by
owned keys. Files that Sentinel does not own are never removed by uninstall.
Every replacement records the exact previous bytes and supported file metadata
under `.git/sentinel/`. If a target contains high-confidence secret material,
Sentinel blocks the mutation instead of persisting that value in a backup.

## Legacy Git policy

`.gitflow-sentinel.json` remains the compatibility configuration for the
historical Git-policy module. When it is valid, Sentinel proposes a migration
and preserves project-specific fields. When it is invalid, planning stops with a
repair recommendation instead of falling back silently.

Its branch-policy field reference remains in
[`policy.md`](policy.md). New project-level decisions belong in
`sentinel.config.json`.
