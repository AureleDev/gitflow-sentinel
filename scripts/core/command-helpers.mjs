import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nextValue, resolveProjectRoot } from "../lib.mjs";
import { inspectProject } from "./inspect-project.mjs";
import { loadDesiredState } from "./config.mjs";
import { buildPlan } from "./planner.mjs";

export function parseProjectArgs(argv, { profile = true, output = true, json = true, setup = false } = {}) {
  const args = {
    projectRoot: ".",
    profile: "standard",
    modules: [],
    agents: [],
    verifiedCommands: [],
    createGitHub: false,
    visibility: "",
    githubOwner: "",
    strategy: "",
    reviewers: undefined,
    json: false,
    output: "",
    remote: false,
    offline: false,
    planOnly: false,
    verbose: false,
    compact: false,
  };
  let positional = false;
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--project-root") { args.projectRoot = nextValue(argv, i, value); i += 1; }
    else if (profile && value === "--profile") { args.profile = nextValue(argv, i, value); i += 1; }
    else if (profile && value === "--modules") {
      args.modules = nextValue(argv, i, value).split(",").map((item) => item.trim()).filter(Boolean);
      i += 1;
    }
    else if (profile && value === "--agents") {
      args.agents = nextValue(argv, i, value).split(",").map((item) => item.trim()).filter(Boolean);
      i += 1;
    }
    else if (profile && value === "--verified-command") {
      args.verifiedCommands.push(nextValue(argv, i, value));
      i += 1;
    }
    else if (profile && value === "--create-github") args.createGitHub = true;
    else if (profile && value === "--visibility") { args.visibility = nextValue(argv, i, value); i += 1; }
    else if (profile && value === "--github-owner") { args.githubOwner = nextValue(argv, i, value); i += 1; }
    else if (profile && value === "--strategy") { args.strategy = nextValue(argv, i, value); i += 1; }
    else if (profile && value === "--reviewers") { args.reviewers = Number(nextValue(argv, i, value)); i += 1; }
    else if (output && value === "--output") { args.output = nextValue(argv, i, value); i += 1; }
    else if (value === "--remote") args.remote = true;
    else if (value === "--offline") args.offline = true;
    else if (setup && value === "--plan-only") args.planOnly = true;
    else if (setup && value === "--verbose") args.verbose = true;
    else if (json && value === "--compact") args.compact = true;
    else if (json && value === "--json") args.json = true;
    else if (value === "--help" || value === "-h") args.help = true;
    else if (!value.startsWith("-") && !positional) { args.projectRoot = value; positional = true; }
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (profile && !["minimal", "standard", "hardened", "custom"].includes(args.profile)) {
    throw new Error("--profile must be minimal, standard, hardened, or custom.");
  }
  if (profile && args.modules.length && args.profile !== "custom") {
    throw new Error("--modules is only valid with --profile custom.");
  }
  if (profile && args.visibility && !["private", "public", "internal"].includes(args.visibility)) {
    throw new Error("--visibility must be private, public, or internal.");
  }
  if (profile && args.strategy && !["detect", "trunk", "git-flow"].includes(args.strategy)) {
    throw new Error("--strategy must be detect, trunk, or git-flow.");
  }
  if (profile && args.reviewers !== undefined && (!Number.isInteger(args.reviewers) || args.reviewers < 0 || args.reviewers > 10)) {
    throw new Error("--reviewers must be an integer between 0 and 10.");
  }
  if (args.remote && args.offline) throw new Error("--remote and --offline cannot be used together.");
  if (args.offline) args.remote = false;
  args.projectRoot = resolveProjectRoot(args.projectRoot);
  return args;
}

export function createPlanFor(root, profile, modules = [], options = {}) {
  const snapshot = inspectProject(root, { remote: Boolean(options.remote) });
  const loaded = loadDesiredState(root, snapshot, { profile, modules, ...options });
  return { snapshot, loaded, plan: buildPlan(root, snapshot, loaded.config, loaded) };
}

export function writeJsonOutput(file, value) {
  const target = path.resolve(file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return target;
}
