import Groq from "groq-sdk";
import {
  detectGroqKeySlot,
  getGroqKeyEnvName,
  GROQ_KEY_ENV_BY_SLOT,
  resolveGroqApiKey,
} from "../config/groqApiKey.js";
import { GROQ_FAST_MODEL, GROQ_QUALITY_MODEL } from "../config/groqModels.js";

const DEFAULT_ORCHESTRATOR_MODEL =
  process.env.GROQ_ORCHESTRATOR_MODEL ||
  process.env.GROQ_MODEL ||
  GROQ_QUALITY_MODEL;

const RATE_LIMIT_FALLBACK_MODEL =
  process.env.GROQ_FALLBACK_MODEL || GROQ_FAST_MODEL;

/** @type {Map<string, import("groq-sdk").Groq>} */
const groqClientsByApiKey = new Map();

let loggedKeySlot = false;

const logKeySlotOnce = (slot) => {
  if (loggedKeySlot) return;
  loggedKeySlot = true;
  const envName = slot ? GROQ_KEY_ENV_BY_SLOT[slot] : getGroqKeyEnvName(slot);
  console.info(`[Groq] API key slot=${slot || "legacy"} env=${envName}`);
};

const getGroqClient = (options = {}) => {
  const slot = options.apiKeySlot || detectGroqKeySlot();
  const apiKey = resolveGroqApiKey(slot);
  logKeySlotOnce(slot);

  let client = groqClientsByApiKey.get(apiKey);
  if (!client) {
    client = new Groq({ apiKey });
    groqClientsByApiKey.set(apiKey, client);
  }
  return client;
};

function completionTokenBudget(options) {
  if (
    typeof options?.max_completion_tokens === "number" &&
    Number.isFinite(options.max_completion_tokens)
  ) {
    return options.max_completion_tokens;
  }
  if (typeof options?.max_tokens === "number" && Number.isFinite(options.max_tokens)) {
    return options.max_tokens;
  }
  return null;
}

const getErrorMessage = (error) => {
  if (error?.error?.message) {
    return error.error.message;
  }

  if (error?.message) {
    return error.message;
  }

  return "Unknown error while calling Groq LLM.";
};

export { detectGroqKeySlot, getGroqKeyEnvName, resolveGroqApiKey };

export const callLLM = async (messages, options = {}) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("callLLM requires a non-empty messages array.");
  }

  const hasInvalidMessage = messages.some(
    (message) =>
      !message ||
      typeof message !== "object" ||
      typeof message.role !== "string" ||
      typeof message.content !== "string"
  );

  if (hasInvalidMessage) {
    throw new Error(
      "Each message must be an object with string role and content."
    );
  }

  try {
    const client = getGroqClient(options);
    const selectedModel =
      typeof options?.model === "string" && options.model.trim()
        ? options.model.trim()
        : DEFAULT_ORCHESTRATOR_MODEL;

    const request = {
      model: selectedModel,
      messages,
    };
    if (typeof options?.temperature === "number" && Number.isFinite(options.temperature)) {
      request.temperature = options.temperature;
    }
    const completionBudget = completionTokenBudget(options);
    if (completionBudget != null) {
      request.max_completion_tokens = completionBudget;
    }
    if (typeof options?.reasoning_effort === "string" && options.reasoning_effort.trim()) {
      request.reasoning_effort = options.reasoning_effort.trim();
    }
    if (typeof options?.include_reasoning === "boolean") {
      request.include_reasoning = options.include_reasoning;
    }
    if (options?.response_format && typeof options.response_format === "object") {
      request.response_format = options.response_format;
    }

    const completion = await client.chat.completions.create(request);
    const choice = completion?.choices?.[0];
    const text = String(choice?.message?.content ?? "").trim();
    if (!text && choice?.finish_reason === "length" && options?._retriedEmpty !== true) {
      const nextBudget = Math.min(Math.max((completionBudget || 1024) * 2, 8192), 16384);
      console.warn(
        `[Groq] Empty completion after reasoning (finish_reason=length) on ${selectedModel}. Retrying with max_completion_tokens=${nextBudget}.`
      );
      return callLLM(messages, {
        ...options,
        reasoning_effort: "low",
        max_completion_tokens: nextBudget,
        max_tokens: undefined,
        _retriedEmpty: true,
      });
    }

    return text;
  } catch (error) {
    const message = getErrorMessage(error);
    const lower = String(message).toLowerCase();
    const isRateLimit =
      lower.includes("rate limit") ||
      lower.includes("rate_limit") ||
      lower.includes("tokens per minute") ||
      lower.includes("tpm") ||
      error?.status === 429 ||
      error?.status === 413;

    const alreadyOnFallback =
      options?.model === RATE_LIMIT_FALLBACK_MODEL ||
      options?.model === "llama-3.1-8b-instant" ||
      options?.model === "llama3-8b-8192";

    // Retry once with the fast model (+ smaller max_tokens) if the primary hits TPM limits
    if (isRateLimit && !alreadyOnFallback && options?.allowFallback !== false) {
      console.warn(
        `⚠️ [Groq] Rate/TPM limit on ${options?.model || DEFAULT_ORCHESTRATOR_MODEL}. Falling back to ${RATE_LIMIT_FALLBACK_MODEL}...`
      );
      const requested = completionTokenBudget(options);
      const nextMax = typeof requested === "number" ? Math.min(requested, 6000) : requested;
      return callLLM(messages, {
        ...options,
        model: RATE_LIMIT_FALLBACK_MODEL,
        reasoning_effort: options?.reasoning_effort || "low",
        max_completion_tokens: nextMax,
        max_tokens: undefined,
      });
    }

    throw new Error(`Groq LLM request failed: ${message}`);
  }
};
