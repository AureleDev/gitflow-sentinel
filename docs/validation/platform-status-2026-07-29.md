# Platform validation status - 2026-07-29

This historical evidence records what was actually verified on the test
machine. It is intentionally excluded from the npm package. The reusable
procedure lives in [`references/platform-validation.md`](../../references/platform-validation.md).

## Verified

- Windows native: real package installation, global bootstrap, transactional
  lifecycle and the Steve brownfield cycle completed locally.
- The CI definition contained Ubuntu, Windows and macOS jobs for Node.js 18 and
  22.

## Not yet verified on this commit

- WSL/Linux: WSL was not installed on the test machine.
- macOS: the branch had not been pushed, so its GitHub-hosted macOS jobs had not
  run.
- GitHub: no real ruleset mutation or other remote write was attempted.
- npm: the alpha package had not been published to the public registry.

## Host limitation observed

Codex selected the project-configuration skill, but its Windows read-only
sandbox helper stopped with `Access denied`. The repository remained unchanged.
WSL/Linux was selected as the next environment for that host-specific test.
