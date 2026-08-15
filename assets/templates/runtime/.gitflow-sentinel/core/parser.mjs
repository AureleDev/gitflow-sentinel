// managed-by: gitflow-sentinel
// Token-based command analysis. The previous generation matched raw strings
// with regexes, which missed chained commands (`a && git push`), quoted args,
// and env prefixes. Here we split a command line into segments, tokenize each
// segment with quote awareness, then reason over tokens.
//
// Threat model note: the agent guard is a smart-assistant nudge, not a hard
// security boundary — a determined process can always bypass a pre-tool hook.
// What this parser does is close the *accidental* and *obvious* bypasses (path
// to the git binary, `sh -c "git push"`, `eval`, command substitution, ssh
// remote commands, git global options that hide the subcommand) so the guard is
// useful in practice. Native Git hooks are also local and bypassable; required
// CI and server-side rules provide the shared enforcement boundary.

// Strip a leading path and a Windows executable extension so `/usr/bin/git`,
// `git.exe`, and `./git` all resolve to the program name `git`. This closes the
// single most common accidental bypass of the previous generation.
export function normalizeProgram(program) {
  const base = String(program || "").split(/[\\/]/).pop() || "";
  return base.replace(/\.(exe|cmd|bat|com)$/i, "");
}

// Split a command line into independently-executed segments on unquoted shell
// separators: ; | & && || and newlines. We keep this conservative on purpose —
// each segment is later checked on its own, so over-splitting is safe.
export function splitSegments(raw) {
  const segments = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      segments.push(current);
      current = "";
      i += 1;
      continue;
    }
    if (ch === ";" || ch === "\n" || ch === "|" || ch === "&") {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter(Boolean);
}

// argv-style tokenizer with single/double/backtick quote handling.
export function tokenize(segment) {
  const tokens = [];
  let cur = "";
  let quote = null;
  let has = false;

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote) quote = null;
      else {
        cur += ch;
        has = true;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has) {
        tokens.push(cur);
        cur = "";
        has = false;
      }
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has) tokens.push(cur);
  return tokens;
}

// Strip leading wrappers (sudo, env VAR=…, time, nice, command, and a few more
// that are common in real shells) so the real program lands at index 0.
const PASSTHROUGH_WRAPPERS = new Set([
  "sudo", "command", "time", "nice", "nohup", "doas", "stdbuf", "setarch",
  "ionice", "exec", "builtin",
]);

function effectiveTokens(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (PASSTHROUGH_WRAPPERS.has(normalizeProgram(t))) {
      i += 1;
      continue;
    }
    if (t === "env") {
      i += 1;
      while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i += 1;
      continue;
    }
    break;
  }
  return tokens.slice(i);
}

// Git global options that consume the *next* token as a value. If we don't skip
// these, `git -C dir push` would mistake `dir` for the subcommand. `-c key=val`
// is captured separately because `-c core.hooksPath=…` is itself a guarded act.
const GIT_VALUE_OPTS = new Set(["-C", "--git-dir", "--work-tree", "--namespace", "--super-prefix"]);

function parseGitInvocation(rest) {
  const configOverrides = [];
  let i = 0;
  while (i < rest.length) {
    const t = rest[i];
    if (t === "-c") {
      if (rest[i + 1]) configOverrides.push(rest[i + 1]);
      i += 2;
      continue;
    }
    if (GIT_VALUE_OPTS.has(t)) {
      i += 2;
      continue;
    }
    if (
      t.startsWith("--git-dir=") || t.startsWith("--work-tree=") ||
      t.startsWith("--namespace=") || t.startsWith("--super-prefix=") ||
      t.startsWith("--exec-path=")
    ) {
      i += 1;
      continue;
    }
    if (t.startsWith("-") || t.startsWith("+")) {
      // valueless global flag (--no-pager, --paginate, --bare, -p, --exec-path)
      i += 1;
      continue;
    }
    break; // first non-option token is the subcommand
  }
  return { subcommand: rest[i] || "", args: rest.slice(i + 1), configOverrides };
}

const GH_VALUE_OPTS = new Set(["--repo", "-R", "--hostname"]);

function parseGhInvocation(rest) {
  let i = 0;
  while (i < rest.length) {
    const token = rest[i];
    if (GH_VALUE_OPTS.has(token)) {
      i += 2;
      continue;
    }
    if (token.startsWith("--repo=") || token.startsWith("--hostname=")) {
      i += 1;
      continue;
    }
    if (token.startsWith("-")) {
      i += 1;
      continue;
    }
    break;
  }
  return {
    group: rest[i] || "",
    subcommand: rest[i + 1] || "",
    args: rest.slice(i + 2),
    globalArgs: rest.slice(0, i),
  };
}

export function analyzeSegment(raw) {
  const tokens = tokenize(raw);
  const eff = effectiveTokens(tokens);
  const program = normalizeProgram(eff[0] || "");
  const seg = { raw, tokens, eff, program };

  if (program === "git") {
    seg.git = parseGitInvocation(eff.slice(1));
  } else if (program === "gh") {
    seg.gh = parseGhInvocation(eff.slice(1));
  }
  return seg;
}

// Shells whose inline-command argument is a fresh command line we must
// re-analyze. Includes POSIX shells (`-c "<cmd>"`) and the Windows shells an
// agent on Windows actually invokes — `cmd.exe` (`/c`/`/k`) and PowerShell
// (`-Command`/`-c`), so `powershell -Command "git push origin main"` and
// `cmd /c "git push origin main"` are re-analyzed the same way `sh -c "…"` is.
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ash", "ksh", "fish", "cmd", "powershell", "pwsh"]);

// Flag(s) that introduce the inline command string, per shell family. Windows
// flags are conventionally case-insensitive and compared lower-cased below.
const SHELL_COMMAND_FLAGS = {
  cmd: ["/c", "/k", "-c", "-k"],
  powershell: ["-command", "-c"],
  pwsh: ["-command", "-c"],
};

// Pull command strings hidden inside a segment so they are checked as first-class
// commands: `sh -c "git push"`, `cmd /c "git push"`, `powershell -Command "git
// push"`, `eval "git push"`, `ssh host "git push"`, `find … -exec git push \;`,
// and `$(…)` / backtick substitutions. Each returned string is strictly a slice
// of the input, so recursion terminates.
function nestedCommands(seg) {
  const out = [];
  const { eff = [], program, raw = "" } = seg;
  const programLower = program.toLowerCase();

  if (SHELLS.has(programLower)) {
    const flags = SHELL_COMMAND_FLAGS[programLower] || ["-c"];
    const ci = eff.findIndex((t) => flags.includes(String(t).toLowerCase()));
    if (ci !== -1 && eff[ci + 1]) out.push(eff[ci + 1]);
  } else if (program === "eval") {
    out.push(eff.slice(1).join(" "));
  } else if (program === "xargs") {
    const after = eff.slice(1).filter((t) => !t.startsWith("-"));
    if (after.length) out.push(after.join(" "));
  } else if (program === "ssh") {
    // last quoted argument is the remote command, e.g. ssh host 'git push'
    const last = eff[eff.length - 1];
    if (last && /\s/.test(last)) out.push(last);
  }

  // find … -exec <cmd> {} \;  /  -execdir <cmd> +
  for (let i = 0; i < eff.length; i += 1) {
    if (eff[i] === "-exec" || eff[i] === "-execdir") {
      const rest = eff.slice(i + 1).filter((t) => t !== ";" && t !== "+" && t !== "{}");
      if (rest.length) out.push(rest.join(" "));
    }
  }

  // command substitutions: $(...) and `...`
  const subRe = /\$\(([^()]+)\)|`([^`]+)`/g;
  let m;
  while ((m = subRe.exec(raw)) !== null) {
    const inner = (m[1] || m[2] || "").trim();
    if (inner) out.push(inner);
  }

  return out;
}

export function analyze(raw, _depth = 0) {
  if (_depth > 6) return []; // guard against pathological nesting
  const out = [];
  const seen = new Set();
  for (const seg of splitSegments(raw)) {
    const a = analyzeSegment(seg);
    if (!seen.has(a.raw)) {
      seen.add(a.raw);
      out.push(a);
    }
    for (const inner of nestedCommands(a)) {
      for (const innerSeg of analyze(inner, _depth + 1)) {
        if (!seen.has(innerSeg.raw)) {
          seen.add(innerSeg.raw);
          out.push(innerSeg);
        }
      }
    }
  }
  return out;
}

// --- option helpers -------------------------------------------------------

// Read a flag value supporting both `--base dev` and `--base=dev`.
export function optionValue(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    for (const name of names) {
      if (a === name) return args[i + 1] || "";
      if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
    }
  }
  return "";
}

export function hasFlag(args, names) {
  return args.some((a) => names.some((n) => a === n || a.startsWith(`${n}=`)));
}

// --- git intent extractors (operate on an analyzed git segment) -----------

export function createdBranch(seg) {
  if (!seg.git) return "";
  const { subcommand, args } = seg.git;
  if (subcommand === "switch" && hasFlag(args, ["-c", "-C", "--create"])) {
    const idx = args.findIndex((a) => ["-c", "-C", "--create"].includes(a));
    return args[idx + 1] || "";
  }
  if (subcommand === "checkout" && hasFlag(args, ["-b", "-B"])) {
    const idx = args.findIndex((a) => ["-b", "-B"].includes(a));
    return args[idx + 1] || "";
  }
  return "";
}

export function isBranchSwitch(seg) {
  if (!seg.git) return false;
  const { subcommand, args } = seg.git;
  if (!["switch", "checkout"].includes(subcommand)) return false;
  if (createdBranch(seg)) return false; // creation is handled separately
  if (args.includes("--")) return false; // file restore, not a branch move
  if (hasFlag(args, ["--detach"])) return true;
  // a positional target that is not a flag means "move to this branch"
  return args.some((a) => !a.startsWith("-"));
}

// Returns the protected destinations this push would write to, given the
// current branch and config. Empty array means the push is not protected.
export function protectedPushTargets(seg, currentBranch, protectedSet) {
  if (!seg.git || seg.git.subcommand !== "push") return [];
  const { args } = seg.git;
  if (hasFlag(args, ["--delete", "-d"])) return []; // deletions handled separately
  const positionals = args.filter((a) => !a.startsWith("-"));
  // positionals[0] is the remote (origin/github); the rest are refspecs
  const refspecs = positionals.slice(1);

  if (refspecs.length === 0) {
    // bare `git push` pushes the current branch to its upstream
    return protectedSet.has(currentBranch) ? [currentBranch] : [];
  }

  const targets = [];
  for (const spec of refspecs) {
    if (spec.startsWith(":")) continue; // pure deletion, handled by pushDeleteTargets
    // +src:dst, src:dst, or plain branch — the destination is what matters
    const forcedClean = spec.replace(/^\+/, "");
    const dst = forcedClean.includes(":") ? forcedClean.split(":").pop() : forcedClean;
    const name = dst.replace(/^refs\/heads\//, "");
    if (protectedSet.has(name)) targets.push(name);
  }
  return targets;
}

// Protected branches this push would DELETE (remote deletion), via `--delete`,
// `-d`, or a `:dst` refspec. Remote deletion of main/dev is destructive and must
// be blocked, not merely warned.
export function pushDeleteTargets(seg, protectedSet) {
  if (!seg.git || seg.git.subcommand !== "push") return [];
  const { args } = seg.git;
  const isDelete = hasFlag(args, ["--delete", "-d"]);
  const positionals = args.filter((a) => !a.startsWith("-"));
  const refspecs = positionals.slice(1);
  const out = [];
  for (const spec of refspecs) {
    let name = null;
    if (spec.startsWith(":")) name = spec.slice(1);
    else if (isDelete) name = spec;
    if (name) {
      name = name.replace(/^refs\/heads\//, "");
      if (protectedSet.has(name)) out.push(name);
    }
  }
  return out;
}

// A push that rewrites remote history: --force / -f / --force-with-lease, or a
// leading `+` on a refspec.
export function isForcePush(seg) {
  if (!seg.git || seg.git.subcommand !== "push") return false;
  if (hasFlag(seg.git.args, ["-f", "--force", "--force-with-lease", "--force-if-includes"])) return true;
  const positionals = seg.git.args.filter((a) => !a.startsWith("-"));
  return positionals.slice(1).some((s) => s.startsWith("+"));
}

// `--no-verify` (or `-n` on commit) disables ALL native git hooks at once. The
// native layer cannot defend against it (the flag turns the native layer off),
// so the agent guard must refuse it outright.
export function disablesHooks(seg) {
  if (!seg.git) return false;
  const sc = seg.git.subcommand;
  if (sc === "commit") return hasFlag(seg.git.args, ["--no-verify", "-n"]);
  if (sc === "push" || sc === "merge") return hasFlag(seg.git.args, ["--no-verify"]);
  return false;
}

// Reconfiguring core.hooksPath neutralizes the native enforcement layer — either
// persisted (`git config core.hooksPath …`) or per-command (`git -c
// core.hooksPath=… …`). Reads are fine; writes are guarded.
export function tampersHooksPath(seg) {
  if (!seg.git) return false;
  if ((seg.git.configOverrides || []).some((kv) => /^core\.hooksPath=/i.test(kv))) return true;
  if (seg.git.subcommand === "config") {
    const a = seg.git.args;
    const setsHooks = a.some((t) => /^core\.hooksPath(=|$)/i.test(t));
    const isRead = a.some((t) => ["--get", "--get-all", "--get-regexp", "-l", "--list"].includes(t));
    return setsHooks && !isRead;
  }
  return false;
}

export function isAmend(seg) {
  return Boolean(seg.git && seg.git.subcommand === "commit" && hasFlag(seg.git.args, ["--amend"]));
}

export function isHardReset(seg) {
  return Boolean(seg.git && seg.git.subcommand === "reset" && hasFlag(seg.git.args, ["--hard", "--keep", "--merge"]));
}

export function isRebase(seg) {
  if (!seg.git || seg.git.subcommand !== "rebase") return false;
  // in-progress controls are not history rewrites in themselves
  return !hasFlag(seg.git.args, ["--abort", "--continue", "--skip", "--quit", "--edit-todo", "--show-current-patch"]);
}

// Tag / release intent: create, delete, or push a tag (often a deploy trigger).
export function tagOperation(seg) {
  if (!seg.git) return null;
  const sc = seg.git.subcommand;
  if (sc === "tag") {
    if (hasFlag(seg.git.args, ["-l", "--list", "-n"])) return null;
    const del = hasFlag(seg.git.args, ["-d", "--delete"]);
    const positionals = seg.git.args.filter((a) => !a.startsWith("-"));
    if (positionals.length || del) return { kind: del ? "delete" : "create", name: positionals[0] || "" };
  }
  if (sc === "push") {
    if (hasFlag(seg.git.args, ["--tags", "--follow-tags"])) return { kind: "push", name: "*" };
    const positionals = seg.git.args.filter((a) => !a.startsWith("-"));
    const tagRef = positionals.slice(1).find((r) => /^[+:]?refs\/tags\//.test(r));
    if (tagRef) return { kind: "push", name: tagRef.replace(/^[:+]?refs\/tags\//, "") };
  }
  return null;
}

export function prCreate(seg) {
  if (!seg.gh || seg.gh.group !== "pr" || seg.gh.subcommand !== "create") return null;
  return {
    base: optionValue(seg.gh.args, ["--base", "-B"]),
    head: optionValue(seg.gh.args, ["--head", "-H"]),
  };
}

export function isPrMerge(seg) {
  return Boolean(seg.gh && seg.gh.group === "pr" && seg.gh.subcommand === "merge");
}

// `gh api repos/<o>/<r>/pulls/<n>/merge` is the documented fallback when
// `gh pr merge` is blocked by a runtime; guard it the same way.
export function isApiMerge(seg) {
  if (!seg.gh || seg.gh.group !== "api") return false;
  return [seg.gh.subcommand, ...seg.gh.args].some((a) => /repos\/[^\s]+\/pulls\/\d+\/merge/.test(a));
}

// Other write-ish `gh api` calls that can rewrite protected state behind the
// back of `gh pr`: ref writes/deletes, branch-protection changes, releases.
// Merges are reported by isApiMerge, so we exclude them here to avoid duplicate
// findings.
export function ghApiMutation(seg) {
  if (!seg.gh || seg.gh.group !== "api" || isApiMerge(seg)) return null;
  const path = seg.gh.subcommand || "";
  const method = (optionValue(seg.gh.args, ["-X", "--method"]) || "GET").toUpperCase();
  const dangerousPath = /\/git\/refs/.test(path) || /\/merges?$/.test(path) || /protection/.test(path) || /\/releases/.test(path);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) || dangerousPath) return { method, path };
  return null;
}

export function isGhRelease(seg) {
  return Boolean(seg.gh && seg.gh.group === "release" && ["create", "delete", "edit"].includes(seg.gh.subcommand));
}

export function isWorktree(seg) {
  return Boolean(seg.git && seg.git.subcommand === "worktree");
}

export function commitMessage(seg) {
  if (!seg.git || seg.git.subcommand !== "commit") return null;
  return optionValue(seg.git.args, ["-m", "--message"]);
}

// File/index mutations that must not happen on a protected branch.
const GIT_MUTATIONS = new Set([
  "add", "commit", "merge", "reset", "clean", "apply", "am", "cherry-pick", "rebase", "restore", "stash",
]);

export function isGitMutation(seg) {
  if (!seg.git) return false;
  if (GIT_MUTATIONS.has(seg.git.subcommand)) return true;
  // `git checkout -- <path>` discards working-tree changes
  if (seg.git.subcommand === "checkout" && seg.git.args.includes("--")) return true;
  return false;
}

const SHELL_WRITERS = new Set([
  "set-content", "add-content", "out-file", "new-item", "remove-item", "rm", "del", "erase",
  "mv", "cp", "move-item", "copy-item", "rename-item", "clear-content", "mkdir", "rmdir", "touch", "tee",
]);

function redirectsToFile(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch !== ">") continue;
    if (raw[i + 1] === "&") continue; // descriptor duplication, e.g. 2>&1
    while (raw[i + 1] === ">") i += 1;
    let rest = raw.slice(i + 1).trimStart();
    const target = rest.match(/^(?:["']([^"']+)["']|([^\s;&|]+))/)?.slice(1).find(Boolean) || "";
    if (!target) return true;
    if (!["/dev/null", "nul", "$null"].includes(target.toLowerCase())) return true;
  }
  return false;
}

export function isShellFileWrite(seg) {
  if (seg.git || seg.gh) return false; // git/gh handled by dedicated rules
  if (SHELLS.has(String(seg.program).toLowerCase()) || ["eval", "xargs", "ssh", "find"].includes(seg.program)) return false; // wrappers re-analyzed
  return SHELL_WRITERS.has(String(seg.program).toLowerCase()) || redirectsToFile(seg.raw);
}

export function isBranchDelete(seg) {
  if (seg.git && seg.git.subcommand === "branch" && hasFlag(seg.git.args, ["-d", "-D"])) return true;
  if (seg.git && seg.git.subcommand === "push" && (hasFlag(seg.git.args, ["--delete", "-d"]) || seg.git.args.some((a) => a.startsWith(":")))) return true;
  return false;
}

const DIRECT_EDIT_TOOLS = new Set([
  "apply_patch", "functions.apply_patch", "edit", "write", "file_edit", "str_replace_editor", "notebookedit", "str_replace_based_edit_tool", "multiedit",
]);

// Match known edit-tool names, plus a substring fallback so an MCP filesystem
// tool (write_file, fs_write, create_file, patch_file…) under a novel name is
// still recognized as a direct file edit on a protected branch.
export function isDirectEditTool(toolName) {
  const n = String(toolName || "").toLowerCase();
  if ([...DIRECT_EDIT_TOOLS].some((t) => n === t || n.endsWith(`.${t}`) || n.endsWith(`__${t}`))) return true;
  return /(^|[._:-])(write|edit|patch)(_?file)?$/.test(n) || /(create|write|patch)_file/.test(n);
}
