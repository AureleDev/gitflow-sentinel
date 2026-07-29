import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_ROOT = path.join(PACKAGE_ROOT, "skills", "configure-project");
const OWNER_FILE = ".sentinel-install.json";

function skillFiles(directory = SOURCE_ROOT, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...skillFiles(full, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function installedAgents(homeDir) {
  const values = [];
  if (existsSync(path.join(homeDir, ".codex"))) values.push("codex");
  if (existsSync(path.join(homeDir, ".claude"))) values.push("claude");
  if (existsSync(path.join(homeDir, ".config", "opencode")) || existsSync(path.join(homeDir, ".opencode"))) values.push("opencode");
  return values.length ? values : ["codex", "opencode"];
}

function destinationFor(homeDir, family) {
  return family === "claude"
    ? path.join(homeDir, ".claude", "skills", "configure-project")
    : path.join(homeDir, ".agents", "skills", "configure-project");
}

function ownerState(destination) {
  const file = path.join(destination, OWNER_FILE);
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return value?.owner === "gitflow-sentinel" ? value : null;
  } catch {
    return null;
  }
}

function sameContent(destination, files) {
  return files.every((relative) => {
    const target = path.join(destination, ...relative.split("/"));
    return existsSync(target) &&
      readFileSync(target).equals(readFileSync(path.join(SOURCE_ROOT, ...relative.split("/"))));
  });
}

function destinationFingerprint(destination, files) {
  const hash = createHash("sha256");
  for (const relative of [...files, OWNER_FILE].sort()) {
    const target = path.join(destination, ...relative.split("/"));
    hash.update(relative);
    hash.update("\0");
    if (existsSync(target)) hash.update(readFileSync(target));
    else hash.update("<missing>");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const suffix = randomUUID();
  const temporary = `${file}.sentinel-${suffix}.tmp`;
  const backup = `${file}.sentinel-${suffix}.bak`;
  writeFileSync(temporary, content);
  if (!existsSync(file)) {
    renameSync(temporary, file);
    return;
  }
  renameSync(file, backup);
  try {
    renameSync(temporary, file);
    rmSync(backup, { force: true });
  } catch (error) {
    if (existsSync(backup) && !existsSync(file)) renameSync(backup, file);
    rmSync(temporary, { force: true });
    throw error;
  }
}

function removeEmptyParents(file, boundary) {
  let current = path.dirname(file);
  const stop = path.resolve(boundary);
  while (current.startsWith(`${stop}${path.sep}`) && current !== stop) {
    if (!existsSync(current) || readdirSync(current).length) break;
    rmdirSync(current);
    current = path.dirname(current);
  }
}

export function planAiInstall({ homeDir = os.homedir(), agents = [] } = {}) {
  const selected = agents.length ? [...new Set(agents)] : installedAgents(homeDir);
  const unsupported = selected.filter((agent) => !["codex", "claude", "opencode"].includes(agent));
  if (unsupported.length) throw new Error(`Unsupported agent(s): ${unsupported.join(", ")}.`);
  const families = [
    selected.some((agent) => ["codex", "opencode"].includes(agent)) ? "portable" : "",
    selected.includes("claude") ? "claude" : "",
  ].filter(Boolean);
  const files = skillFiles();
  const destinations = families.map((family) => {
    const destination = destinationFor(homeDir, family);
    const exists = existsSync(destination);
    const owned = Boolean(ownerState(destination));
    const unchanged = exists && sameContent(destination, files);
    return {
      family,
      agents: family === "claude" ? ["claude"] : selected.filter((agent) => ["codex", "opencode"].includes(agent)),
      destination,
      status: unchanged ? "unchanged" : exists && !owned ? "conflict" : exists ? "update" : "create",
      fingerprint: destinationFingerprint(destination, files),
    };
  });
  return { homeDir: path.resolve(homeDir), agents: selected, files, destinations };
}

export function applyAiInstall(plan, { dryRun = false, simulateFailureAfter = 0 } = {}) {
  if (dryRun) return { ...plan, applied: false };
  const current = planAiInstall({ homeDir: plan.homeDir, agents: plan.agents });
  const expectedState = plan.destinations.map(({ destination, status, fingerprint }) => ({ destination, status, fingerprint }));
  const currentState = current.destinations.map(({ destination, status, fingerprint }) => ({ destination, status, fingerprint }));
  if (JSON.stringify(currentState) !== JSON.stringify(expectedState)) {
    throw new Error("AI skill install plan is stale; inspect the destinations again.");
  }
  const conflict = plan.destinations.find((item) => item.status === "conflict");
  if (conflict) {
    throw new Error(`Refusing to replace unmanaged skill at ${conflict.destination}. Move or remove it explicitly, then retry.`);
  }
  const packageVersion = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version;
  const operations = [];
  for (const item of plan.destinations) {
    if (item.status === "unchanged") continue;
    for (const relative of plan.files) {
      const source = path.join(SOURCE_ROOT, ...relative.split("/"));
      const target = path.join(item.destination, ...relative.split("/"));
      operations.push({
        destination: item.destination,
        cleanupBoundary: item.status === "create" ? path.dirname(item.destination) : item.destination,
        target,
        before: existsSync(target) ? readFileSync(target) : null,
        content: readFileSync(source),
      });
    }
    const ownerTarget = path.join(item.destination, OWNER_FILE);
    operations.push({
      destination: item.destination,
      cleanupBoundary: item.status === "create" ? path.dirname(item.destination) : item.destination,
      target: ownerTarget,
      before: existsSync(ownerTarget) ? readFileSync(ownerTarget) : null,
      content: Buffer.from(`${JSON.stringify({
        owner: "gitflow-sentinel",
        version: packageVersion,
        files: plan.files,
      }, null, 2)}\n`),
    });
  }

  const completed = [];
  try {
    for (const operation of operations) {
      atomicWrite(operation.target, operation.content);
      completed.push(operation);
      if (simulateFailureAfter && completed.length === simulateFailureAfter) {
        throw new Error("Simulated AI skill installation failure.");
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const operation of completed.reverse()) {
      try {
        if (operation.before === null) {
          rmSync(operation.target, { force: true });
          removeEmptyParents(operation.target, operation.cleanupBoundary);
        } else {
          atomicWrite(operation.target, operation.before);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    throw new Error(`${error.message}${rollbackErrors.length ? ` Rollback issues: ${rollbackErrors.join("; ")}` : " Changes were rolled back."}`);
  }
  return { ...plan, applied: true };
}
