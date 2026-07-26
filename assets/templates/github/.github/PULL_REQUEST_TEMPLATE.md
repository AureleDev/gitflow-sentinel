<!-- gitflow-sentinel PR template -->
## What & why

<!-- Summary of the change and the motivation. -->

## Branch routing

- [ ] Head branch follows `type/topic` ({{SHORT_PREFIXES}}, …) or is `{{INTEGRATION_BRANCH}}`/`release/*`/`hotfix/*`.
- [ ] Base is `{{INTEGRATION_BRANCH}}` for short branches, or `{{STABLE_BRANCH}}` only for `{{INTEGRATION_BRANCH}}`/`release/*`/`hotfix/*`.

## Checklist

- [ ] Conventional Commit messages.
- [ ] No secrets or `.env*` files committed.
- [ ] No `--no-verify` / hook bypass used.
- [ ] Tests/checks pass locally.
- [ ] Docs updated if behavior changed.
