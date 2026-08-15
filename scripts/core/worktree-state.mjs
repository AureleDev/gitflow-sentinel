import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { isFailure, run } from "../lib.mjs";
import { directoryHash, sha256, stableJson } from "./contracts.mjs";

function pathspec(root, exclude = []) {
  const values = exclude
    .map((file) => path.relative(root, path.resolve(file)).replaceAll("\\", "/"))
    .filter((relative) => relative && relative !== ".." && !relative.startsWith("../"));
  return values.length
    ? ["--", ".", ...values.map((relative) => `:(top,exclude,literal)${relative}`)]
    : [];
}

function gitOutput(root, args, label) {
  const result = run("git", ["-C", root, ...args], root);
  if (isFailure(result)) throw new Error(`Could not read ${label}: ${result.message}`);
  return String(result);
}

function changedPaths(status) {
  const tokens = String(status).split("\0");
  const files = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.length < 3) continue;
    const code = token.slice(0, 2);
    files.add(token.slice(3));
    if (/[RC]/.test(code) && tokens[index + 1]) files.add(tokens[index += 1]);
  }
  return [...files].sort();
}

function fileSignature(root, relative) {
  const file = path.resolve(root, relative.replaceAll("/", path.sep));
  const resolvedRoot = path.resolve(root);
  const boundary = `${resolvedRoot}${path.sep}`;
  if (file !== resolvedRoot && !file.startsWith(boundary)) {
    throw new Error(`Git returned an unsafe worktree path: ${relative}`);
  }
  if (!existsSync(file)) return { path: relative, type: "missing" };
  const stat = lstatSync(file);
  const mode = stat.mode & 0o777;
  if (stat.isSymbolicLink()) {
    return { path: relative, type: "symlink", mode, target: readlinkSync(file) };
  }
  if (stat.isFile()) {
    return { path: relative, type: "file", mode, size: stat.size, hash: sha256(readFileSync(file)) };
  }
  if (stat.isDirectory()) {
    return { path: relative, type: "directory", mode, hash: directoryHash(file) };
  }
  return { path: relative, type: "other", mode };
}

export function gitWorktreeState(root, { exclude = [] } = {}) {
  const filters = pathspec(root, exclude);
  const status = gitOutput(
    root,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", ...filters],
    "Git worktree state",
  );
  const index = gitOutput(
    root,
    ["diff", "--cached", "--raw", "-z", "--no-abbrev", ...filters],
    "Git index state",
  );
  const files = changedPaths(status).map((relative) => fileSignature(root, relative));
  return {
    status,
    hash: sha256(stableJson({ status, index, files })),
  };
}

export function gitWorktreeHash(root, options = {}) {
  return gitWorktreeState(root, options).hash;
}
