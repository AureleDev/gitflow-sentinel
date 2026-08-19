# Desired state configuration

The current declaration is `sentinel.config.json`. It is validated before planning by
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
    "strategy": "git-flow",
    "stableBranch": "main",
    "integrationBranch": "dev",
    "legacyBranch": "master",
    "protectedBranches": ["main", "dev"]
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
      "git", "git-policy", "github", "agents", "docs", "quality",
      "ci", "security", "dependencies", "release"
    ]
  }
}
```

## Profiles

- `minimal`: Git, agent instructions and essential security.
- `standard`: the default foundation set, including local Git-policy feedback.
- `hardened`: stronger remote review, code-scanning, ownership and provenance
  controls.
- `custom`: only explicitly enabled modules.

V1 custom profiles must include `git`, because approved transaction journals
and backups are stored in the repository's actual Git directory.

Detected tools are reused. Selecting a profile never authorizes Sentinel to add
a new formatter, linter, package manager, paid service or deployment provider.

`quality.verifiedCommands` is declarative, not an instruction to execute.
Before a command can be copied into generated CI, run the two-step
`gitflow-sentinel check` preview and approval flow. Evidence becomes invalid as
soon as the commit, branch or worktree changes.

The standard profile includes `git-policy`. Its local hooks remain bypassable
early feedback; CI and verified remote rules carry shared enforcement.

## Project decisions

`project.visibility` may be `private`, `public` or `internal`. It controls the
visibility of a repository created by Sentinel. Repository creation is always
R3 and requires a separate approval. In the current alpha, changing the
visibility of an already connected repository is not planned or applied by the
GitHub adapter; perform and verify that external action separately.

`git.strategy` may be `trunk`, `git-flow` or `detect` on the CLI. New
configurations default to Git Flow (`main` stable, `dev` integration). Interactive
setup offers trunk as an explicit refusal of that default. Existing recorded
trunk configurations are preserved until `--strategy git-flow` is requested.

## Ownership

Managed text is delimited by Sentinel markers. Structured JSON is merged by
owned keys. Files that Sentinel does not own are never removed by uninstall.
Every replacement records the exact previous bytes and supported file metadata
under `.git/sentinel/`. If a target contains high-confidence secret material,
Sentinel blocks the mutation instead of persisting that value in a backup.

## Legacy Git policy

`.gitflow-sentinel.json` remains the compatibility configuration for the local
`git-policy` runtime. It is maintained by `standard`, `hardened`, or an explicit
custom profile containing `git-policy`. Sentinel preserves project-specific
fields during migration. When the legacy file is invalid, planning stops with a
repair recommendation instead of falling back silently.

Its branch-policy field reference remains in
[`policy.md`](policy.md). New project-level decisions belong in
`sentinel.config.json`.
