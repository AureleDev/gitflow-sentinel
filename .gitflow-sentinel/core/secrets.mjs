// managed-by: gitflow-sentinel
// Built-in secret detection over staged content. The goal is not to replace a
// dedicated scanner but to be a cheap, dependency-free last line of defense
// before a commit, catching the obvious leaks so they never reach history where
// removal is costly. When gitleaks/git-secrets is present, the native hook
// defers to it (see githooks/native.mjs); these checks are the fallback.
//
// Redaction rule: a finding NEVER includes the raw secret. We print the match
// type and a masked preview only, so a CI log or terminal scrollback does not
// itself become the leak.

// Files that almost always hold secrets. `.env.example`/`.env.sample` are the
// sanctioned templates and stay allowed.
const ALLOWED_ENV = /(^|\/)\.env\.(example|sample|template|dist|defaults?)$/i;
const SECRET_FILE_PATTERNS = [
  { name: "dotenv file (.env*)", re: /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/ },
  { name: "private key file", re: /(^|\/)(id_(rsa|dsa|ecdsa|ed25519)|.*\.(pem|key|pfx|p12|ppk|keystore|jks))$/i },
  { name: "credentials file", re: /(^|\/)(\.npmrc|\.pgpass|\.netrc|\.git-credentials|kubeconfig|terraform\.tfstate(\.backup)?)$/i },
  { name: "cloud credentials file", re: /(^|\/)(\.aws\/credentials|serviceaccount.*\.json|gcloud.*\.json|.*-key\.json)$/i },
  { name: "secret-bearing filename", re: /(^|\/)[^/]*(secret|credential|password)[^/]*\.(json|ya?ml|txt|cfg|ini|env)$/i },
];

// High-confidence provider tokens. Each has a recognizable, low-false-positive
// shape, so these are safe to flag on sight.
const PATTERNS = [
  { name: "AWS access key id", re: /\bA(KIA|SIA|GPA|IDA|ROA|IPA|NPA|NVA)[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[posru]_[A-Za-z0-9]{36,}\b/ },
  { name: "GitHub fine-grained PAT", re: /\bgithub_pat_[0-9A-Za-z_]{22,}\b/ },
  { name: "GitLab PAT", re: /\bglpat-[0-9A-Za-z_-]{20,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Slack webhook", re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { name: "Stripe secret key", re: /\b(sk|rk)_(live|test)_[0-9A-Za-z]{16,}\b/ },
  { name: "OpenAI API key", re: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: "SendGrid API key", re: /\bSG\.[\w-]{16,}\.[\w-]{16,}\b/ },
  { name: "npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  { name: "connection string with credentials", re: /\b(postgres|postgresql|mysql|mongodb(\+srv)?|redis|amqp|amqps):\/\/[^\s:@/]+:[^\s:@/]+@/i },
];

// A secret-ish assignment whose value is long enough to plausibly be a key. The
// keyword may be embedded in a larger identifier (e.g. AWS_SECRET_ACCESS_KEY,
// MY_API_TOKEN) — `\b` does not break on underscores, so we allow surrounding
// word characters around the keyword instead.
const ASSIGNMENT_RE = /[\w-]*(?:api[_-]?key|apikey|secret|token|passwd|password|client[_-]?secret|access[_-]?key|private[_-]?key|authorization|bearer|credential|connection[_-]?string)[\w-]*\s*[:=]\s*(['"]?)([^\s'"]{12,})\1/i;

// Values that look high-entropy but are benign — avoid blocking real commits.
const ENTROPY_ALLOW = /^([0-9a-f]{7,40}|[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}|sha\d*-|\$\{|process\.env|import\.meta)/i;

function shannon(str) {
  const freq = {};
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
  let h = 0;
  for (const c of Object.values(freq)) {
    const p = c / str.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// Mask a matched value so the finding can be printed without leaking it.
function redact(value) {
  const t = String(value || "");
  if (t.length <= 6) return "•".repeat(t.length || 3);
  return `${t.slice(0, 3)}…${"•".repeat(4)} (${t.length} chars)`;
}

export function scanStagedFiles(files) {
  const out = [];
  for (const f of files || []) {
    if (ALLOWED_ENV.test(f)) continue;
    const hit = SECRET_FILE_PATTERNS.find((p) => p.re.test(f));
    if (hit) out.push({ file: f, reason: `${hit.name} staged` });
  }
  return out;
}

// Inspect only added lines (`+` prefix) from a unified=0 staged diff.
export function scanDiff(diff) {
  if (!diff) return [];
  const findings = [];
  for (const line of diff.split(/\r?\n/)) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const body = line.slice(1);

    let matched = false;
    for (const { name, re } of PATTERNS) {
      const m = re.exec(body);
      if (m) {
        findings.push({ reason: name, sample: redact(m[0]) });
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Generic secret-ish assignment with a high-entropy value.
    const a = ASSIGNMENT_RE.exec(body);
    if (a) {
      const value = a[2];
      if (!ENTROPY_ALLOW.test(value) && shannon(value) >= 3.5) {
        findings.push({ reason: "high-entropy secret assignment", sample: redact(value) });
      }
    }
  }
  return findings;
}
