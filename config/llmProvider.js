/**
 * Which LLM HTTP provider callLLM should use.
 *
 * - openrouter: pay-per-go via https://openrouter.ai/api/v1 (prod)
 * - groq: existing Groq free/paid keys (local/dev fallback)
 *
 * Set LLM_PROVIDER=openrouter|groq to force. Otherwise auto-selects OpenRouter
 * when OPENROUTER_API_KEY is present.
 */

export const LLM_PROVIDERS = Object.freeze({
  OPENROUTER: "openrouter",
  GROQ: "groq",
});

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function resolveLlmProvider() {
  const raw = String(process.env.LLM_PROVIDER || "")
    .trim()
    .toLowerCase();
  if (raw === LLM_PROVIDERS.OPENROUTER || raw === LLM_PROVIDERS.GROQ) {
    return raw;
  }
  if (String(process.env.OPENROUTER_API_KEY || "").trim()) {
    return LLM_PROVIDERS.OPENROUTER;
  }
  return LLM_PROVIDERS.GROQ;
}

/**
 * @returns {string}
 */
export function resolveOpenRouterApiKey() {
  const keyed = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (keyed) return keyed;
  throw new Error(
    "Missing OPENROUTER_API_KEY environment variable. Add it to the backend .env (and Docker env_file) for OpenRouter."
  );
}

export function isOpenRouterConfigError(message) {
  return String(message || "").includes("Missing OPENROUTER_API_KEY");
}

export function isLlmConfigError(message) {
  const msg = String(message || "");
  return (
    isOpenRouterConfigError(msg) ||
    msg.includes("Missing GROQ_KEY_") ||
    msg.includes("Missing GROQ_API_KEY") ||
    msg.includes("Missing Groq API key")
  );
}
