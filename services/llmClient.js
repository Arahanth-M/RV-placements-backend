import Groq from "groq-sdk";

const DEFAULT_ORCHESTRATOR_MODEL =
  process.env.GROQ_ORCHESTRATOR_MODEL ||
  process.env.GROQ_MODEL ||
  "llama-3.1-70b-versatile";

let groqClient = null;

const getGroqClient = () => {
  if (groqClient) {
    return groqClient;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY environment variable.");
  }

  groqClient = new Groq({ apiKey });
  return groqClient;
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
    const client = getGroqClient();
    const selectedModel =
      typeof options?.model === "string" && options.model.trim()
        ? options.model.trim()
        : DEFAULT_ORCHESTRATOR_MODEL;

    const completion = await client.chat.completions.create({
      model: selectedModel,
      messages,
    });

    return completion?.choices?.[0]?.message?.content?.trim() || "";
  } catch (error) {
    const message = getErrorMessage(error);
    throw new Error(`Groq LLM request failed: ${message}`);
  }
};

