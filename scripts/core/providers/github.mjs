import { run, isFailure } from "../../lib.mjs";

export const RULESET_NAME = "gitflow-sentinel";

export function githubRepoSlug(remote) {
  const match = String(remote).match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : "";
}

export function githubLocalState(remote) {
  return {
    checked: false,
    available: false,
    authenticated: false,
    slug: githubRepoSlug(remote),
    connected: false,
    visibility: "",
    defaultBranch: "",
    permissions: {},
    remoteBranches: [],
    ruleset: { readable: false, present: false },
  };
}

function parseJsonResult(result, fallback) {
  if (isFailure(result)) return { ok: false, value: fallback };
  try { return { ok: true, value: JSON.parse(result || "null") ?? fallback }; }
  catch { return { ok: false, value: fallback }; }
}

export function normalizeRuleset(value) {
  if (!value) return { readable: true, present: false };
  const pullRequest = (value.rules || []).find((rule) => rule.type === "pull_request");
  return {
    readable: true,
    present: true,
    id: value.id,
    enforcement: value.enforcement || "",
    include: value.conditions?.ref_name?.include || [],
    ruleTypes: (value.rules || []).map((rule) => rule.type).sort(),
    reviewers: pullRequest?.parameters?.required_approving_review_count ?? null,
  };
}

export function buildRulesetPayload(branches, reviewers) {
  return {
    name: RULESET_NAME,
    target: "branch",
    enforcement: "active",
    conditions: {
      ref_name: {
        exclude: [],
        include: branches.map((branch) => `refs/heads/${branch}`),
      },
    },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: reviewers,
          required_review_thread_resolution: true,
        },
      },
    ],
    bypass_actors: [],
  };
}

export function rulesetMatches(current, branches, reviewers) {
  if (!current?.readable || !current.present || current.enforcement !== "active") return false;
  const types = new Set(current.ruleTypes || []);
  if (!["deletion", "non_fast_forward", "pull_request"].every((type) => types.has(type))) return false;
  if (current.reviewers !== reviewers) return false;
  const included = new Set(current.include || []);
  const expected = branches.map((branch) => `refs/heads/${branch}`);
  return expected.length > 0 && expected.every((branch) => included.has(branch));
}

export function listRulesets(root, slug, { timeoutMs = 5_000 } = {}) {
  const result = run("gh", ["api", "-H", "Accept: application/vnd.github+json", `repos/${slug}/rulesets`], root, { timeout: timeoutMs });
  if (isFailure(result)) return result;
  const parsed = parseJsonResult(result, []);
  return parsed.ok && Array.isArray(parsed.value)
    ? parsed.value
    : { error: new Error("invalid JSON"), message: "GitHub returned invalid ruleset JSON." };
}

export function readRuleset(root, slug, id, { timeoutMs = 5_000 } = {}) {
  const result = run("gh", ["api", "-H", "Accept: application/vnd.github+json", `repos/${slug}/rulesets/${id}`], root, { timeout: timeoutMs });
  if (isFailure(result)) return result;
  const parsed = parseJsonResult(result, null);
  return parsed.ok && parsed.value
    ? parsed.value
    : { error: new Error("invalid JSON"), message: "GitHub returned invalid ruleset JSON." };
}

export function applyRuleset(root, slug, existingId, payload) {
  const endpoint = existingId ? `repos/${slug}/rulesets/${existingId}` : `repos/${slug}/rulesets`;
  return run(
    "gh",
    ["api", "--method", existingId ? "PUT" : "POST", "-H", "Accept: application/vnd.github+json", endpoint, "--input", "-"],
    root,
    { input: JSON.stringify(payload), timeout: 30_000 },
  );
}

function remoteBranches(root, timeoutMs) {
  const result = run("git", ["-C", root, "ls-remote", "--heads", "origin"], root, { timeout: timeoutMs });
  if (isFailure(result)) return [];
  return String(result)
    .split(/\r?\n/)
    .map((line) => line.match(/\srefs\/heads\/(.+)$/)?.[1] || "")
    .filter(Boolean)
    .sort();
}

function inspectRuleset(root, slug, timeoutMs) {
  const listed = listRulesets(root, slug, { timeoutMs });
  if (isFailure(listed)) return { readable: false, present: false };
  const summary = listed.find((item) => item.name === RULESET_NAME);
  if (!summary) return { readable: true, present: false };
  const detail = readRuleset(root, slug, summary.id, { timeoutMs });
  if (isFailure(detail)) return { readable: false, present: true, id: summary.id };
  return normalizeRuleset(detail);
}

export function inspectGitHubProvider(root, remote, { timeoutMs = 5_000 } = {}) {
  const slug = githubRepoSlug(remote);
  const version = run("gh", ["--version"], root, { timeout: timeoutMs });
  const available = !isFailure(version);
  const authenticated = available && !isFailure(run("gh", ["auth", "status"], root, { timeout: timeoutMs }));
  const base = {
    checked: true,
    available,
    authenticated,
    slug,
    connected: false,
    visibility: "",
    defaultBranch: "",
    permissions: {},
    remoteBranches: [],
    ruleset: { readable: false, present: false },
  };
  if (!authenticated || !slug) return base;
  const result = run(
    "gh",
    ["repo", "view", slug, "--json", "nameWithOwner,visibility,defaultBranchRef,viewerPermission"],
    root,
    { timeout: timeoutMs },
  );
  if (isFailure(result)) return base;
  const parsed = parseJsonResult(result, null);
  if (!parsed.ok || !parsed.value) return base;
  const value = parsed.value;
  const resolvedSlug = value.nameWithOwner || slug;
  return {
    ...base,
    connected: true,
    slug: resolvedSlug,
    visibility: String(value.visibility || "").toLowerCase(),
    defaultBranch: value.defaultBranchRef?.name || "",
    permissions: { viewer: value.viewerPermission || "" },
    remoteBranches: remoteBranches(root, timeoutMs),
    ruleset: inspectRuleset(root, resolvedSlug, timeoutMs),
  };
}

export const githubProviderAdapter = {
  id: "github",
  inspect: inspectGitHubProvider,
  buildRulesetPayload,
  diffRuleset(current, branches, reviewers) {
    return rulesetMatches(current, branches, reviewers) ? [] : [{ type: "github-ruleset" }];
  },
  applyRuleset,
  verifyRuleset(value, branches, reviewers) {
    return rulesetMatches(normalizeRuleset(value), branches, reviewers);
  },
};
