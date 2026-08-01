import Groq from "groq-sdk";
import {
  detectGroqKeySlot,
  getGroqKeyEnvName,
  GROQ_KEY_ENV_BY_SLOT,
  resolveGroqApiKey,
} from "../config/groqApiKey.js";

const DEFAULT_ORCHESTRATOR_MODEL =
  process.env.GROQ_ORCHESTRATOR_MODEL ||
  process.env.GROQ_MODEL ||
  "llama-3.3-70b-versatile";

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
    if (typeof options?.max_tokens === "number" && Number.isFinite(options.max_tokens)) {
      request.max_tokens = options.max_tokens;
    }

    const completion = await client.chat.completions.create(request);

    return completion?.choices?.[0]?.message?.content?.trim() || "";
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
      options?.model === "llama-3.1-8b-instant" ||
      options?.model === "llama3-8b-8192";

    // Retry once with 8b (+ smaller max_tokens) if 70b hits rate/TPM limits
    if (isRateLimit && !alreadyOnFallback) {
      console.warn(
        `⚠️ [Groq] Rate/TPM limit on ${options?.model || DEFAULT_ORCHESTRATOR_MODEL}. Falling back to 8b...`
      );
      const nextMax =
        typeof options?.max_tokens === "number" && Number.isFinite(options.max_tokens)
          ? Math.min(options.max_tokens, 3500)
          : options?.max_tokens;
      return callLLM(messages, {
        ...options,
        model: "llama-3.1-8b-instant",
        max_tokens: nextMax,
      });
    }

    throw new Error(`Groq LLM request failed: ${message}`);
  }
};
