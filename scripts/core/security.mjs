const TOKEN_PATTERN = /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|glpat-[A-Za-z0-9_-]{12,}|sk-(?:proj-)?[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|npm_[A-Za-z0-9_-]{12,})\b/i;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const CREDENTIAL_URL_PATTERN = /(?:postgres|mysql|mongodb(?:\+srv)?|https?):\/\/[^/\s:@]+:[^@\s/]+@/i;
const ASSIGNMENT_PATTERN = /\b(?:access[_-]?token|api[_-]?key|auth[_-]?token|client[_-]?secret|password|secret)\b["']?\s*[:=]\s*["']?([^"',}\s]+)/gi;

function looksLikeReference(value) {
  return !value ||
    value.startsWith("$") ||
    value.startsWith("<") ||
    value.startsWith("env:") ||
    /^(?:change-me|example|placeholder|redacted|your[_-])/i.test(value);
}

export function containsSecretMaterial(value) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value || "");
  if (PRIVATE_KEY_PATTERN.test(text) || TOKEN_PATTERN.test(text) || CREDENTIAL_URL_PATTERN.test(text)) return true;
  ASSIGNMENT_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(ASSIGNMENT_PATTERN)) {
    if (!looksLikeReference(match[1]) && match[1].length >= 8) return true;
  }
  return false;
}

export function assertBackupSafe(target, value) {
  if (containsSecretMaterial(value)) {
    throw new Error(
      `Refusing to modify ${target}: it contains secret-like material and Sentinel would need to persist an exact backup. Move the secret to an environment or provider secret first.`,
    );
  }
}
