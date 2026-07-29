# Profiles

## minimal

Use for a small or exploratory project. Configure Git, the canonical agent contract, portable skill discovery, ignore rules, and essential secret checks.

## standard

Use by default. Add project documentation, explicitly verified quality commands,
CI, Dependabot, GitHub policy planning, and release-history preparation. Treat
detected package scripts as candidates until they have been reviewed and run
locally. Configure only tools already present; present new tool adoption as a
separate decision.

## hardened

Use for sensitive, public, regulated, or multi-contributor repositories. Add
the optional historical local Git-policy runtime, supported CodeQL analysis,
stricter GitHub review rules, CODEOWNERS planning, provenance recommendations,
and stronger verification. Confirm availability and plan restrictions before
proposing remote controls.

## custom

Use only when the user explicitly selects modules. Record enabled modules in `sentinel.config.json`; do not silently inherit the standard profile.

The supported V1 modules are `git`, `git-policy`, `github`, `agents`, `docs`,
`quality`, `ci`, `security`, `dependencies`, and `release`. `git-policy` is
optional and is not enabled by `standard`.
