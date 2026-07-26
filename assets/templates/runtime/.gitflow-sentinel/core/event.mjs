// managed-by: gitflow-sentinel
// Normalizes the hook payload that a runtime sends on stdin into one shape the
// policy engine understands. Codex and Claude Code use slightly different field
// names and nesting; we read every known location so a single hook script works
// on both without per-platform branches.

export function parseInput(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return { raw };
  }
}

function firstString(...values) {
  for (const v of values) {
    if (typeof v === "string" && v) return v;
  }
  return "";
}

export function toolName(event) {
  return firstString(
    event?.tool_name,
    event?.tool?.name,
    event?.tool,
    event?.name,
    event?.recipient_name,
    event?.function?.name,
    event?.tool_input?.tool_name,
    event?.input?.tool_name,
  ).trim();
}

function commandFrom(node) {
  return firstString(
    node?.command,
    node?.cmd,
    node?.tool_input?.command,
    node?.tool_input?.cmd,
    node?.parameters?.command,
    node?.parameters?.cmd,
    node?.input?.command,
    node?.input?.cmd,
    node?.arguments?.command,
    node?.arguments?.cmd,
  );
}

// Walk every nested tool_uses array at any depth so a batch-of-batches payload
// does not hide a deep command from the guard.
function collectNested(node, out, depth = 0) {
  if (!node || depth > 6) return;
  out.push(commandFrom(node));
  const nests = node?.tool_input?.tool_uses ?? node?.input?.tool_uses ?? node?.tool_uses ?? [];
  if (Array.isArray(nests)) {
    for (const n of nests) collectNested(n, out, depth + 1);
  }
}

// Collect every command in the payload, including the parallel/batch tool
// shapes where multiple shell calls are nested under tool_uses (recursively).
export function commands(event) {
  const out = [commandFrom(event), commandFrom(event?.tool_input), commandFrom(event?.input)];
  collectNested(event, out);
  // The same command is reachable at several payload paths; dedupe so a guard
  // message is not printed once per alias.
  return [...new Set(out.map((c) => c.trim()).filter(Boolean))];
}

export function cwd(event) {
  const nests = event?.tool_input?.tool_uses ?? event?.input?.tool_uses ?? event?.tool_uses ?? [];
  if (Array.isArray(nests)) {
    for (const n of nests) {
      const w = n?.parameters?.workdir ?? n?.tool_input?.workdir ?? n?.workdir;
      if (w) return String(w);
    }
  }
  // Mirror commandFrom's lookup breadth: a flat (non-nested) payload can carry
  // workdir directly under parameters/arguments, same shape as its command.
  return firstString(
    event?.tool_input?.workdir, event?.input?.workdir,
    event?.parameters?.workdir, event?.arguments?.workdir,
    event?.cwd,
  ) || process.cwd();
}

// Best-effort runtime label, used only for friendlier messaging. Blocking works
// the same way (exit 2 + stderr) regardless of platform.
export function platform(event) {
  if (event?.hook_event_name || event?.session_id || toolName(event) === "Bash") return "claude";
  if (toolName(event).startsWith("functions.") || event?.tool_uses) return "codex";
  return "generic";
}

export async function readStdin() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}
