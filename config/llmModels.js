/**
 * Shared LLM model IDs (OpenRouter + Groq both use these OpenAI-style slugs).
 */
export const LLM_QUALITY_MODEL = "openai/gpt-oss-120b";
export const LLM_FAST_MODEL = "openai/gpt-oss-20b";

/** @deprecated Prefer LLM_QUALITY_MODEL — kept for existing imports. */
export const GROQ_QUALITY_MODEL = LLM_QUALITY_MODEL;
/** @deprecated Prefer LLM_FAST_MODEL — kept for existing imports. */
export const GROQ_FAST_MODEL = LLM_FAST_MODEL;

export function resolveQualityModel() {
  return (
    trimEnv("LLM_MODEL") ||
    trimEnv("LLM_QUALITY_MODEL") ||
    trimEnv("GROQ_ORCHESTRATOR_MODEL") ||
    trimEnv("GROQ_MODEL") ||
    LLM_QUALITY_MODEL
  );
}

export function resolveFallbackModel() {
  return (
    trimEnv("LLM_FALLBACK_MODEL") ||
    trimEnv("GROQ_FALLBACK_MODEL") ||
    LLM_FAST_MODEL
  );
}

function trimEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
