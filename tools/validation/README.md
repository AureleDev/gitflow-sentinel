# Internal validation tools

These programs build and test Gitflow Sentinel itself. They are called through
the `npm run verify` and `npm run validate:*` commands and by CI.

They are deliberately excluded from the npm package. Runtime commands live in
`scripts/`, while unit tests and agent eval cases remain in `tests/` and
`evals/`.
