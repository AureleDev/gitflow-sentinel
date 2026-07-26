// managed-by: gitflow-sentinel
// Cooperate with best-in-class tools instead of duplicating weaker versions of
// them. When gitleaks/git-secrets or commitlint are present, the native hooks
// defer to (or add) them. Everything here degrades gracefully: a missing tool or
// a failed spawn never throws, so a hook is never broken by this module.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export function hasCommand(name) {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    execFileSync(probe, [name], { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

const COMMITLINT_CONFIGS = [
  "commitlint.config.js", "commitlint.config.cjs", "commitlint.config.mjs", "commitlint.config.ts",
  ".commitlintrc", ".commitlintrc.json", ".commitlintrc.js", ".commitlintrc.cjs", ".commitlintrc.yml", ".commitlintrc.yaml",
];

export function detectScanners(root = ".") {
  return {
    gitleaks: hasCommand("gitleaks"),
    commitlint: hasCommand("commitlint") || COMMITLINT_CONFIGS.some((f) => existsSync(path.join(root, f))),
  };
}

// Run gitleaks against the staged set. We try the current and the legacy
// sub-commands so it works across gitleaks versions. Returns { ran, clean }.
export function runGitleaksStaged(root = ".") {
  const attempts = [
    ["git", "--staged", "--no-banner", "--redact"],
    ["protect", "--staged", "--no-banner", "--redact"],
  ];
  for (const args of attempts) {
    try {
      execFileSync("gitleaks", args, { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
      return { ran: true, clean: true, output: "" };
    } catch (e) {
      const out = String((e && (e.stdout || e.stderr)) || "");
      // exit 1 with leak output = real finding; usage error = try next form
      if (/leak|finding|secret/i.test(out) || e?.status === 1) {
        return { ran: true, clean: false, output: out.slice(0, 1500) };
      }
    }
  }
  return { ran: false, clean: true, output: "" }; // gitleaks unusable -> fall back
}

// Validate a commit message file with commitlint. Returns { ran, ok, output }.
export function runCommitlint(root, msgFile) {
  const isWin = process.platform === "win32";
  // A `commitlint` resolved on PATH is usually an npm bin shim — a `.cmd` on
  // Windows that execFileSync cannot spawn directly (Node cannot CreateProcess a
  // .cmd/.bat file itself, regardless of whether it is named "commitlint" or
  // "npx.cmd" — that's a Windows/Node spawn limitation, not a PATH-resolution
  // issue, and it fails with EINVAL/ENOENT even when the binary genuinely
  // exists and runs fine from an interactive shell). `shell: true` routes the
  // spawn through cmd.exe, which resolves and runs .cmd shims correctly. On
  // POSIX a direct bin carries a shebang and runs fine without a shell.
  const direct = !isWin && hasCommand("commitlint");
  const cmd = direct ? "commitlint" : "npx";
  const args = direct ? ["--edit", msgFile] : ["--no", "--", "commitlint", "--edit", msgFile];
  try {
    // Node warns that shell:true concatenates args without escaping — bounded
    // here because every arg is a fixed literal except msgFile, which git itself
    // provides (the COMMIT_EDITMSG path), not attacker-controlled input.
    execFileSync(cmd, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: isWin });
    return { ran: true, ok: true, output: "" };
  } catch (e) {
    const out = String((e && (e.stdout || e.stderr)) || e?.message || "");
    return { ran: true, ok: false, output: out.slice(0, 1500) };
  }
}
