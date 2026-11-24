import Groq from "groq-sdk";
import OpenAI from "openai";
import {
  detectGroqKeySlot,
  getGroqKeyEnvName,
  GROQ_KEY_ENV_BY_SLOT,
  resolveGroqApiKey,
} from "../config/groqApiKey.js";
import {
  LLM_PROVIDERS,
  OPENROUTER_BASE_URL,
  resolveLlmProvider,
  resolveOpenRouterApiKey,
} from "../config/llmProvider.js";
import { resolveFallbackModel, resolveQualityModel } from "../config/llmModels.js";

/** @type {Map<string, import("groq-sdk").Groq>} */
const groqClientsByApiKey = new Map();

/** @type {Map<string, import("openai").OpenAI>} */
const openRouterClientsByApiKey = new Map();

let loggedProviderOnce = false;

const logProviderOnce = (provider, detail) => {
  if (loggedProviderOnce) return;
  loggedProviderOnce = true;
  console.info(`[LLM] provider=${provider} ${detail}`);
};

const getGroqClient = (options = {}) => {
  const slot = options.apiKeySlot || detectGroqKeySlot();
  const apiKey = resolveGroqApiKey(slot);
  const envName = slot ? GROQ_KEY_ENV_BY_SLOT[slot] : getGroqKeyEnvName(slot);
  logProviderOnce(LLM_PROVIDERS.GROQ, `slot=${slot || "legacy"} env=${envName}`);

  let client = groqClientsByApiKey.get(apiKey);
  if (!client) {
    client = new Groq({ apiKey });
    groqClientsByApiKey.set(apiKey, client);
  }
  return client;
};

const getOpenRouterClient = () => {
  const apiKey = resolveOpenRouterApiKey();
  logProviderOnce(LLM_PROVIDERS.OPENROUTER, `env=OPENROUTER_API_KEY base=${OPENROUTER_BASE_URL}`);

  let client = openRouterClientsByApiKey.get(apiKey);
  if (!client) {
    const defaultHeaders = {};
    const referer = String(process.env.OPENROUTER_HTTP_REFERER || process.env.FRONTEND_URL || "").trim();
    const title = String(process.env.OPENROUTER_APP_TITLE || "RV Placements").trim();
    if (referer) defaultHeaders["HTTP-Referer"] = referer;
    if (title) defaultHeaders["X-Title"] = title;

    client = new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders,
    });
    openRouterClientsByApiKey.set(apiKey, client);
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

function raisedCompletionBudget(current) {
  return Math.min(Math.max((current || 1024) * 2, 8192), 16384);
}

function isJsonValidateFailed(error) {
  const body = error?.error;
  const code =
    (body && typeof body.code === "string" && body.code) ||
    (body?.error && typeof body.error.code === "string" && body.error.code) ||
    "";
  if (code === "json_validate_failed") return true;
  const text = String(error?.message || "");
  return text.includes("json_validate_failed") || text.includes("Failed to generate JSON");
}

const getErrorMessage = (error) => {
  if (error?.error?.message) {
    return error.error.message;
  }

  if (error?.message) {
    return error.message;
  }

  return "Unknown error while calling LLM.";
};

function buildChatRequest(messages, options, selectedModel) {
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
  return request;
}

async function createChatCompletion(messages, options, selectedModel) {
  const provider = resolveLlmProvider();
  const request = buildChatRequest(messages, options, selectedModel);

  if (provider === LLM_PROVIDERS.OPENROUTER) {
    const client = getOpenRouterClient();
    return client.chat.completions.create(request);
  }

  const client = getGroqClient(options);
  return client.chat.completions.create(request);
}

export { detectGroqKeySlot, getGroqKeyEnvName, resolveGroqApiKey, resolveLlmProvider };

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

  const defaultModel = resolveQualityModel();
  const fallbackModel = resolveFallbackModel();
  const provider = resolveLlmProvider();

  try {
    const selectedModel =
      typeof options?.model === "string" && options.model.trim()
        ? options.model.trim()
        : defaultModel;

    const completion = await createChatCompletion(messages, options, selectedModel);
    const choice = completion?.choices?.[0];
    const text = String(choice?.message?.content ?? "").trim();
    if (!text && choice?.finish_reason === "length" && options?._retriedEmpty !== true) {
      const nextBudget = raisedCompletionBudget(completionTokenBudget(options));
      console.warn(
        `[LLM:${provider}] Empty completion after reasoning (finish_reason=length) on ${selectedModel}. Retrying with max_completion_tokens=${nextBudget}.`
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
      options?.model === fallbackModel ||
      options?.model === "llama-3.1-8b-instant" ||
      options?.model === "llama3-8b-8192";

    // JSON mode rejects a clipped or unescaped completion with 400 before any text is returned.
    if (isJsonValidateFailed(error) && options?._retriedJson !== true) {
      const nextBudget = raisedCompletionBudget(completionTokenBudget(options));
      console.warn(
        `[LLM:${provider}] JSON validation failed on ${options?.model || defaultModel}. Retrying with max_completion_tokens=${nextBudget}.`
      );
      return callLLM(
        [
          ...messages,
          {
            role: "user",
            content:
              "Return one JSON object only. Escape newlines inside strings as \\n. Do not stop before the JSON object is closed.",
          },
        ],
        {
          ...options,
          reasoning_effort: "low",
          max_completion_tokens: nextBudget,
          max_tokens: undefined,
          _retriedJson: true,
        }
      );
    }

    // Retry once with the fast model (+ smaller max_tokens) if the primary hits TPM limits
    if (isRateLimit && !alreadyOnFallback && options?.allowFallback !== false) {
      console.warn(
        `⚠️ [LLM:${provider}] Rate/TPM limit on ${options?.model || defaultModel}. Falling back to ${fallbackModel}...`
      );
      const requested = completionTokenBudget(options);
      const nextMax = typeof requested === "number" ? Math.min(requested, 6000) : requested;
      return callLLM(messages, {
        ...options,
        model: fallbackModel,
        reasoning_effort: options?.reasoning_effort || "low",
        max_completion_tokens: nextMax,
        max_tokens: undefined,
      });
    }

    throw new Error(`LLM request failed (${provider}): ${message}`);
  }
};
