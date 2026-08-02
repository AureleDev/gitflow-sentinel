# Platform validation guide

Gitflow Sentinel supports Windows directly. WSL is optional for normal use and
provides an additional real Linux validation environment on a Windows machine.

## Windows

Run the same package and transaction checks used by CI:

```powershell
npm install --ignore-scripts
npm run verify
npm run validate:evals
npm run validate:package
npm run validate:self-host
```

## WSL and Linux

To add WSL, open PowerShell as an administrator and run:

```powershell
wsl --install
```

Restart Windows if requested, open Ubuntu, then create the Linux username and
password. Microsoft documents the current procedure in
[Install WSL](https://learn.microsoft.com/windows/wsl/install).

From a Linux copy of the repository, run:

```bash
npm install --ignore-scripts
npm run verify
npm run validate:evals
npm run validate:package
npm run validate:self-host
```

The package validation uses isolated temporary user and npm prefix directories;
it does not replace an existing agent skill or mutate another project.

## macOS

The CI workflow runs the verification and real-package checks on Ubuntu,
Windows and macOS with every supported Node.js version in the matrix. A
platform is considered verified for a commit only when its corresponding jobs
are green. See
[GitHub-hosted runners](https://docs.github.com/actions/concepts/runners/github-hosted-runners).

Historical machine-specific results belong under `docs/validation/` and are
not included in the npm package.
