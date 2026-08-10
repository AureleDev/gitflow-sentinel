<!-- gitflow-sentinel PR template -->
## What & why

<!-- Summary of the change and the motivation. -->

## Branch routing

- [ ] Head branch follows `type/topic` (feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert, …) or is `main`/`release/*`/`hotfix/*`.
- [ ] Base is `main` for short branches, or `main` only for `main`/`release/*`/`hotfix/*`.

## Checklist

- [ ] Conventional Commit messages.
- [ ] No secrets or `.env*` files committed.
- [ ] No `--no-verify` / hook bypass used.
- [ ] Tests/checks pass locally.
- [ ] Docs updated if behavior changed.
