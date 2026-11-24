/**
 * Groq / OpenRouter production model IDs.
 * @see https://console.groq.com/docs/deprecations
 * @see https://openrouter.ai/openai/gpt-oss-120b
 */
export {
  LLM_FAST_MODEL as GROQ_FAST_MODEL,
  LLM_QUALITY_MODEL as GROQ_QUALITY_MODEL,
  LLM_FAST_MODEL,
  LLM_QUALITY_MODEL,
  resolveFallbackModel,
  resolveQualityModel,
} from "./llmModels.js";
