// managed-by: gitflow-sentinel
// The decision engine. Pure function of its context so it can be unit-tested
// without a real repo: feed it config + git state + parsed segments, get back a
// list of decisions. The hook entrypoints turn `block` decisions into exit
// code 2 (the convention both Codex and Claude Code honor) and `warn`
// decisions into advisory stderr lines.
//
// Override discipline: the override marker can sanction a routine, deliberate
// action (a one-off direct commit, a sanctioned merge). It can NEVER be used to
// commit a secret, to run `--no-verify`, or to reconfigure core.hooksPath —
// those would let an agent disable the safety system itself, which defeats the
// point. Those three rules ignore hasOverride on purpose.
import * as P from "./parser.mjs";
import {
  isProtected, isShortBranch, headMatchesRoute, commitTypes, conventionalCommitRegex,
  conventionalMode, historyMode, tagMode, worktreeRoot,
} from "./config.mjs";
import { scanStagedFiles, scanDiff } from "./secrets.mjs";

function decision(level, code, message, details = []) {
  return { level, code, message, details };
}

// "off" -> null (skip), "warn"/"block" -> that level.
function levelFor(mode) {
  return mode === "off" ? null : mode;
}

export function evaluate(ctx) {
  const { config, state, toolName = "", segments = [], hasOverride = false, stagedDiff = "" } = ctx;
  const out = [];
  if (!state?.isRepo) return out;

  const branch = state.branch || "";
  const detached = branch === "(detached)";
  const onProtected = isProtected(config, branch);
  const integration = config.integrationBranch;
  const stable = config.stableBranch;
  const protectedSet = new Set([...config.protectedBranches, config.legacyBranch].filter(Boolean));
  const marker = config.overrideMarker;
  // A branch that already exists on the remote — rewriting its history affects
  // other people even though it is not a "protected" branch.
  const sharedBranch = Boolean(state.upstream) || state.ahead || state.behind;

  // 1. Direct file edits (apply_patch/edit/write) on a protected branch. These
  //    never go through git, so the command guards below would miss them.
  if (onProtected && !hasOverride && P.isDirectEditTool(toolName)) {
    out.push(decision("block", "DIRECT_EDIT_PROTECTED",
      `Direct file edits on ${branch} are blocked.`, [
        `Create a short branch from clean ${integration} before editing files.`,
        `For a sanctioned one-off, include ${marker} in the tool input with a reason.`,
      ]));
  }

  for (const seg of segments) {
    // --- Safety-system integrity: never overridable -----------------------
    // These would switch the guards off, so the override marker does not apply.
    if (P.disablesHooks(seg)) {
      out.push(decision("block", "NO_VERIFY",
        "Bypassing git hooks with --no-verify is not allowed.", [
          "The native hooks are the real enforcement layer; --no-verify disables all of them.",
          "Remove --no-verify. If a hook is wrong, fix the policy in .gitflow-sentinel.json.",
        ]));
    }
    if (P.tampersHooksPath(seg)) {
      out.push(decision("block", "HOOKSPATH_TAMPER",
        "Changing core.hooksPath would disable the native guardrails.", [
          "Leave core.hooksPath pointing at .gitflow-sentinel/githooks.",
          "If you are intentionally migrating hook managers, do it as a reviewed change, not inline.",
        ]));
    }

    // 2. Worktree-dirty branch creation, and short branches off the wrong base.
    const created = P.createdBranch(seg);
    if (created) {
      if (state.dirty && !hasOverride) {
        out.push(decision("block", "CREATE_DIRTY",
          "Branch creation blocked: the worktree is not clean.", [
            "Commit, checkpoint WIP, or stash intentionally first, then create the branch.",
          ]));
      }
      if (isShortBranch(config, created) && branch !== integration && !hasOverride) {
        out.push(decision("block", "SHORT_BRANCH_BASE",
          `Do not create ${created} from ${branch}.`, [
            `Short branches start from a clean, up-to-date ${integration}.`,
            `Run: git switch ${integration} && git pull --ff-only, then create the branch.`,
          ]));
      }
    }

    // 3. Switching branches with a dirty worktree loses or drags changes.
    if (P.isBranchSwitch(seg) && state.dirty && !hasOverride) {
      out.push(decision("block", "SWITCH_DIRTY",
        "Branch switch blocked: the worktree is not clean.", [
          "Commit, checkpoint, stash, or resolve current changes before switching.",
        ]));
    }

    // 4. Commits/merges and file mutations on protected branches.
    if (onProtected && !hasOverride && (P.isGitMutation(seg) || P.isShellFileWrite(seg))) {
      out.push(decision("block", "MUTATION_PROTECTED",
        `${branch} is protected; commits, merges, resets, and writes are blocked here.`, [
          `Move the work to a short branch from ${integration}.`,
          `Sanctioned exception: run it as \`${marker} <command>\` (env-var prefix, not a trailing comment — a shell strips anything after "#" before the native git hook ever sees it, so a comment satisfies this agent check but not pre-commit/pre-push).`,
        ]));
    }

    // 4b. Detached HEAD: protections keyed on the branch name fall away, so warn
    //     loudly when work is committed onto a detached checkout.
    if (detached && (P.isGitMutation(seg) || P.commitMessage(seg))) {
      out.push(decision("warn", "DETACHED_HEAD",
        "Committing on a detached HEAD; this work is not on any branch.", [
          `Create a short branch first: git switch -c <prefix>/<name>, based on ${integration}.`,
        ]));
    }

    // 5. Secrets in the staged set, checked when a commit is attempted. NEVER
    //    overridable — a secret in history is too costly to allow on a marker.
    if (config.secretsGuard && seg.git?.subcommand === "commit") {
      const fileHits = scanStagedFiles(state.stagedFiles);
      const diffHits = scanDiff(stagedDiff);
      if (fileHits.length || diffHits.length) {
        const details = [
          ...fileHits.map((h) => `${h.file}: ${h.reason}`),
          ...diffHits.map((h) => `${h.reason}${h.sample ? ` (near: ${h.sample})` : ""}`),
        ];
        out.push(decision("block", "SECRET_STAGED",
          "Commit blocked: staged changes look like they contain secrets.", [
            ...details,
            "Unstage the file, add it to .gitignore, or move the value to a secret manager.",
            "Use .env.example for shareable placeholders. (This rule cannot be overridden.)",
          ]));
      }
    }

    // 6. Conventional Commits: warn or block per config.
    const convMode = conventionalMode(config);
    if (convMode !== "off") {
      const msg = P.commitMessage(seg);
      if (msg && !conventionalCommitRegex(config).test(msg) && !/^(Merge|Revert|fixup!|squash!) /.test(msg)) {
        out.push(decision(convMode === "block" ? "block" : "warn", "COMMIT_FORMAT",
          "Commit message does not follow Conventional Commits.", [
            `Use: <type>(<scope>): <summary> — types: ${commitTypes(config).join(", ")}.`,
            `Example: feat(auth): add token refresh`,
          ]));
      }
    }

    // 7. Direct pushes to protected branches.
    const pushTargets = P.protectedPushTargets(seg, branch, protectedSet);
    if (pushTargets.length && !hasOverride) {
      out.push(decision("block", "PUSH_PROTECTED",
        `Direct push to ${pushTargets.join(", ")} is blocked.`, [
          `Use PRs: short branch -> ${integration}, then ${integration} -> ${stable}.`,
          `Sanctioned exception: run it as \`${marker} <command>\` (env-var prefix, not a trailing comment — a shell strips anything after "#" before the native git hook ever sees it, so a comment satisfies this agent check but not pre-commit/pre-push).`,
        ]));
    }

    // 7b. Remote deletion of a protected branch — destructive, always blocked.
    const deleteTargets = P.pushDeleteTargets(seg, protectedSet);
    if (deleteTargets.length && !hasOverride) {
      out.push(decision("block", "PROTECTED_DELETE",
        `Deleting the remote branch ${deleteTargets.join(", ")} is blocked.`, [
          "Protected branches must not be deleted from the remote.",
          `Sanctioned exception: run it as \`${marker} <command>\` (env-var prefix, not a trailing comment — a shell strips anything after "#" before the native git hook ever sees it, so a comment satisfies this agent check but not pre-commit/pre-push).`,
        ]));
    }

    // 7c. Force-push: to a protected branch it is always blocked; to a shared
    //     (already-pushed) branch it is governed by historyProtection.
    if (P.isForcePush(seg)) {
      const forcedProtected = P.protectedPushTargets(seg, branch, protectedSet);
      if (forcedProtected.length || (pushTargets.length === 0 && onProtected)) {
        out.push(decision("block", "FORCE_PUSH_PROTECTED",
          `Force-pushing to ${(forcedProtected[0] || branch)} is blocked.`, [
            "Force-push rewrites published history on a protected branch.",
            "Open a PR with the corrected history instead.",
          ]));
      } else {
        const lvl = levelFor(historyMode(config));
        if (lvl && sharedBranch) {
          out.push(decision(lvl, "FORCE_PUSH_SHARED",
            `Force-pushing ${branch} rewrites history others may have pulled.`, [
              "Prefer --force-with-lease, and tell collaborators before rewriting a shared branch.",
            ]));
        }
      }
    }

    // 7d. History rewrites (amend / hard reset / rebase) on an already-pushed
    //     branch. On protected branches this is already blocked by rule 4; here
    //     we cover the shared-but-not-protected case.
    if (!onProtected && sharedBranch && (P.isAmend(seg) || P.isHardReset(seg) || P.isRebase(seg))) {
      const lvl = levelFor(historyMode(config));
      if (lvl) {
        out.push(decision(lvl, "REWRITE_SHARED",
          `Rewriting history on ${branch}, which is already published.`, [
            "Amend/reset/rebase here will require a force-push and can disrupt collaborators.",
            "If the branch is solely yours, proceed with --force-with-lease; otherwise prefer a follow-up commit.",
          ]));
      }
    }

    // 8. PR routing.
    const pr = P.prCreate(seg);
    if (pr) {
      const head = pr.head || branch;
      if (!pr.base) {
        out.push(decision("block", "PR_NO_BASE", "PR creation must declare its base branch.", [
          `Use --base ${integration} for short branches, or --base ${stable} for promotion.`,
        ]));
      } else if (pr.base === config.legacyBranch) {
        out.push(decision("block", "PR_TO_LEGACY", `PRs to ${config.legacyBranch} are blocked.`, [
          `Normalize the stable branch to ${stable}, then use ${integration} -> ${stable}.`,
        ]));
      } else if (!Object.prototype.hasOwnProperty.call(config.prRoutes, pr.base)) {
        out.push(decision("block", "PR_UNKNOWN_BASE", `PR base ${pr.base} has no declared route.`, [
          "Declare the route in .gitflow-sentinel.json before opening this PR.",
        ]));
      } else if (config.prRoutes[pr.base] && !headMatchesRoute(config.prRoutes[pr.base], head)) {
        out.push(decision("block", "PR_ROUTE", `PR to ${pr.base} cannot come from ${head}.`, [
          `Allowed heads for ${pr.base}: ${config.prRoutes[pr.base].join(", ")}.`,
        ]));
      }
    }

    // 9. Merges via gh, guarded so a human approval is recorded in the command.
    if ((P.isPrMerge(seg) || P.isApiMerge(seg)) && !hasOverride) {
      out.push(decision("block", "PR_MERGE", "PR merge requires an explicit approval marker.", [
        `Run it as \`${marker} <command>\` (env-var prefix): merge approved.`,
        `After merge, verify PR state, fetch --prune, switch to ${integration}, and pull --ff-only.`,
      ]));
    }

    // 9b. Other write-ish gh api calls (ref writes, branch-protection edits)
    //     are a back door around gh pr — block them.
    const apiMut = P.ghApiMutation(seg);
    if (apiMut && !hasOverride) {
      out.push(decision("block", "GH_API_WRITE",
        `gh api ${apiMut.method} ${apiMut.path} can rewrite protected state.`, [
          "Use the reviewed PR flow rather than direct GitHub API mutations.",
          `Sanctioned exception: run it as \`${marker} <command>\` (env-var prefix, not a trailing comment — a shell strips anything after "#" before the native git hook ever sees it, so a comment satisfies this agent check but not pre-commit/pre-push).`,
        ]));
    }

    // 10. Tag & release governance.
    const tagLvl = levelFor(tagMode(config));
    if (tagLvl) {
      const tag = P.tagOperation(seg);
      if (tag) {
        out.push(decision(tagLvl, "TAG_OP",
          `Tag ${tag.kind}${tag.name && tag.name !== "*" ? ` (${tag.name})` : ""} — tags often trigger production deploys.`, [
            "Confirm this tag/release is intended and follows your release process.",
          ]));
      }
      if (P.isGhRelease(seg)) {
        out.push(decision(tagLvl, "RELEASE_OP",
          "Creating/editing a GitHub release — this may trigger a production deploy.", [
            "Confirm the release is cut from the right ref and approved.",
          ]));
      }
    }

    // 11. Worktrees: supported, but steered to a dedicated location.
    if (P.isWorktree(seg)) {
      out.push(decision("warn", "WORKTREE", "git worktree is allowed but should stay isolated.", [
        `Create it under ${worktreeRoot(config)} and never treat it as the principal repo.`,
        "Remove it when the parallel task is done to avoid stale checkouts.",
      ]));
    }

    // 12. Branch deletion needs a glance that nothing is lost (protected
    //     deletions are already blocked above; this covers the rest).
    if (P.isBranchDelete(seg) && !P.pushDeleteTargets(seg, protectedSet).length) {
      out.push(decision("warn", "BRANCH_DELETE", "Verify the branch is merged or abandoned before deleting.", [
        "Check the PR is merged, or that the work is intentionally discarded.",
      ]));
    }

    // 13. Sync reminders around push when remote/upstream is missing.
    if (seg.git?.subcommand === "push") {
      if (!state.remotes) {
        out.push(decision("warn", "NO_REMOTE", "Push requested but no remote is configured.", [
          "Configure origin (git remote add origin <url>) before syncing.",
        ]));
      } else if (!state.upstream && !P.hasFlag(seg.git.args, ["-u", "--set-upstream"])) {
        out.push(decision("warn", "NO_UPSTREAM", "Branch has no upstream.", [
          `Use: git push -u origin ${branch} on the first sync.`,
        ]));
      }
    }
  }

  return dedupe(out);
}

// Two payload paths can surface the same command; collapse identical decisions
// so a message is not printed twice.
function dedupe(decisions) {
  const seen = new Set();
  const out = [];
  for (const d of decisions) {
    const key = `${d.level}|${d.code}|${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

// Convenience used by hook entrypoints: split block vs warn.
export function partition(decisions) {
  return {
    blocks: decisions.filter((d) => d.level === "block"),
    warns: decisions.filter((d) => d.level === "warn"),
  };
}
