# Configuration reference

All behavior is driven by `.gitflow-sentinel.json` at the repo root. Missing
fields fall back to the defaults in `core/config.mjs`; a malformed file falls
back to defaults entirely (a hook never crashes mid-command). The CI check reads
the same file, so server and local enforcement stay in sync.

## Fields

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `version` | number | `1` | Config-schema version. |
| `stableBranch` | string | `"main"` | The stable release branch. No direct work. |
| `integrationBranch` | string | `"dev"` | Where short branches are integrated via PR. |
| `protectedBranches` | string[] | `["main","dev"]` | Branches where commits/pushes/edits are blocked. |
| `legacyBranch` | string | `"master"` | Treated as legacy stable; normalize before work. |
| `shortBranchPrefixes` | string[] | Conventional types | Allowed short-branch prefixes (`feat/…`). Also the commit-type vocabulary **when `commitTypes` is null**. |
| `commitTypes` | string[] \| null | `null` | Commit-type vocabulary, decoupled from `shortBranchPrefixes`. When `null`, reuses `shortBranchPrefixes`. Set only if commit types differ from branch prefixes. |
| `prRoutes` | object | see below | Allowed head→base PR routes. `"feat/*"` = prefix glob, `"dev"` = exact. |
| `conventionalCommits` | `"off"`\|`"warn"`\|`"block"` | `"warn"` | Conventional-Commits enforcement. Booleans accepted (`true`→`warn`, `false`→`off`). `"block"` makes the `commit-msg` hook **reject** a non-conforming message. |
| `secretsGuard` | bool | `true` | Block commits that stage secrets or `.env*`. |
| `historyProtection` | `"off"`\|`"warn"`\|`"block"` | `"warn"` | History rewrite on **already-published but NON-protected** branches (e.g. force-push of your own feature after a rebase). Note: force-push/reset/rewrite on a **protected** branch are always blocked by their dedicated rules, regardless of this knob. |
| `tagProtection` | `"off"`\|`"warn"`\|`"block"` | `"warn"` | Tag/release governance (tags and releases are frequent prod-deploy triggers). |
| `worktreesAllowed` | bool | `true` | Allow worktrees (with an isolation reminder). |
| `worktreeRoot` | string | derived at install (`"../<project>-worktrees"`) | Where worktrees should live. Empty means "derive at install"; a runtime fallback message is used otherwise (never reads "undefined"). |
| `delegateScanners` | bool | `true` | When `gitleaks`/`git-secrets`/`commitlint` are present, the native hook uses them: `gitleaks` **in addition to** the built-in secret scan, `commitlint` **instead of** the built-in commit-format regex. Falls back to the built-ins otherwise. |
| `policyDocPath` | string | `"CONTRIBUTING.md"` | Policy doc the guard points readers to. Configurable so a repo without `CONTRIBUTING.md` is not sent to a dead path. |
| `overrideMarker` | string | `"GITFLOW_OVERRIDE=explicit"` | Inline marker that bypasses one block. |

## Default `prRoutes`

```json
{
  "dev": ["feat/*","fix/*","docs/*","style/*","refactor/*","perf/*","test/*","build/*","ci/*","chore/*","revert/*","hotfix/*"],
  "main": ["dev","release/*","hotfix/*"]
}
```

A head matches a route if it equals an exact entry (`"dev"`) or starts with a
`"prefix/"` glob (`"feat/*"`).

## Recipes

**Trunk-based (single protected branch):**
```json
{
  "stableBranch": "main",
  "integrationBranch": "main",
  "protectedBranches": ["main"],
  "prRoutes": { "main": ["feat/*","fix/*","docs/*","chore/*"] }
}
```

**Rename dev to develop, add a staging branch:**
```json
{
  "integrationBranch": "develop",
  "protectedBranches": ["main","develop","staging"],
  "prRoutes": {
    "develop": ["feat/*","fix/*","chore/*"],
    "staging": ["develop"],
    "main": ["staging","hotfix/*"]
  }
}
```

**Relax commit-message and secret checks (not recommended):**
```json
{ "conventionalCommits": false, "secretsGuard": false }
```

**Strict mode (block on every tri-state knob):**
```json
{ "conventionalCommits": "block", "historyProtection": "block", "tagProtection": "block" }
```

After editing the config, re-run `node scripts/verify.mjs --project-root <path>`
to confirm the engine still behaves as expected with your settings.
