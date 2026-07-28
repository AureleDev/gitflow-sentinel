# Migration to Sentinel Core

V3 preserves the package name and the historical runtime while moving project
configuration to `sentinel.config.json` and transactions to `.git/sentinel/`.

## Safe sequence

1. Run `gitflow-sentinel inspect <path> --json`.
2. Run `gitflow-sentinel doctor --project-root <path>`.
3. Keep the working tree unchanged while reviewing legacy findings.
4. Generate a plan with `gitflow-sentinel init <path> --output <plan.json>`.
5. Review the proposed conversion and every R2/R3 action.
6. Apply the exact plan hash.
7. Run `gitflow-sentinel verify <path> --json`.

## Configuration

A valid `.gitflow-sentinel.json` is treated as legacy Git-policy data. Sentinel
copies its meaningful branch and policy choices into the compatibility module
and creates the project-wide `sentinel.config.json`.

An invalid JSON file is preserved exactly. Sentinel reports its parser or
semantic errors and does not create a replacement until the repair is reviewed.

## Existing wiring

Codex and Claude JSON settings are merged by owned keys. Existing hooks and
unrelated options stay in place. An invalid settings file is not normalized to
an empty object.

Existing Husky, Lefthook or pre-commit ownership is detected. Sentinel does not
take over `core.hooksPath` when another manager owns it; the plan records the
required integration as an explicit recommendation.

## Rollback

Each local action records:

- its precondition hash;
- whether the path existed;
- the exact previous bytes;
- the verification result;
- its ownership marker.

`rollback` restores those bytes and removes only paths created by the
transaction. A greenfield rollback removes the `.git` directory only when the
transaction created it and it still contains no commit, remote or nonstandard
Git directory.

Remote R3 actions are not silently deleted during rollback. Sentinel records
their state and requires a new compensating plan with explicit approval.

## Legacy commands

`install`, `orchestrate`, `github-protect` and `legacy-uninstall` remain
available to maintain 2.x installations. New work should use
`inspect → plan → apply → verify`.
