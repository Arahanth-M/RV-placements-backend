const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bgsk_[A-Za-z0-9_-]{8,}\b/g,
  /\btvly-[A-Za-z0-9_-]{8,}\b/g,
  /\bfc-[A-Za-z0-9_-]{8,}\b/g,
  /Bearer\s+\S+/gi,
];

/**
 * Provider text safe to show to a platform admin. Secrets are redacted.
 * @param {unknown} error
 * @param {string} fallback
 */
export function publicProviderMessage(error, fallback) {
  const raw = String(error?.message || error || "")
    .replace(/\s+/g, " ")
    .trim();
  let text = raw;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }
  if (!text || text === "[redacted]") return fallback;
  return text.slice(0, 500);
}

/** Groq / Tavily quota and token-rate failures. */
export function isTokenLimitError(value) {
  const lower = String(value || "").toLowerCase();
  return (
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("tokens per minute") ||
    lower.includes("tokens per day") ||
    lower.includes("token limit") ||
    lower.includes("too many requests") ||
    lower.includes("quota") ||
    /\btpm\b/.test(lower) ||
    /\b429\b/.test(lower)
  );
}

/**
 * @param {unknown} error
 * @param {string} code
 * @param {string} fallback
 * @param {string} secretId
 */
export function llmActionError(error, code, fallback, secretId) {
  const message = publicProviderMessage(error, fallback);
  const tokenLimit = isTokenLimitError(error?.message) || isTokenLimitError(message);
  const wrapped = new Error(message);
  wrapped.code = code;
  wrapped.status = tokenLimit ? 429 : 500;
  wrapped.tokenLimit = tokenLimit;
  wrapped.secretId = tokenLimit ? secretId : "";
  return wrapped;
}
