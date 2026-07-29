function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function usesHashComments(target = "") {
  const normalized = String(target).replaceAll("\\", "/");
  return [".gitignore", ".gitattributes"].includes(normalized.split("/").at(-1));
}

function markers(label, target, { legacy = false } = {}) {
  if (!legacy && usesHashComments(target)) {
    return {
      start: `# gitflow-sentinel:start ${label}`,
      end: `# gitflow-sentinel:end ${label}`,
    };
  }
  return {
    start: `<!-- gitflow-sentinel:start ${label} -->`,
    end: `<!-- gitflow-sentinel:end ${label} -->`,
  };
}

export function mergeManagedBlock(existing, block, label, target = "") {
  const current = markers(label, target);
  const next = `${current.start}\n${block.trim()}\n${current.end}`;
  const candidates = [current];
  if (usesHashComments(target)) candidates.push(markers(label, target, { legacy: true }));

  for (const candidate of candidates) {
    const pattern = new RegExp(`${escapeRegExp(candidate.start)}[\\s\\S]*?${escapeRegExp(candidate.end)}`);
    if (pattern.test(existing)) return existing.replace(pattern, next);
  }
  return `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${next}\n`;
}
