import { getJSON, setJSON } from "../src/utils/redisHelpers.js";

const REDIS_KEY = "platform:llm-budgets";
const MIN_TOKENS = 256;
const MAX_TOKENS = 16384;

export const LLM_BUDGET_DEFS = Object.freeze([
  {
    id: "research",
    secretId: "groq-web-search",
    label: "Question and experience research",
    defaultValue: 8192,
  },
  {
    id: "enhance",
    secretId: "groq-admin",
    label: "Enhance questions",
    defaultValue: 4096,
  },
  {
    id: "answers-text",
    secretId: "groq-admin",
    label: "Written, SQL, and MCQ answers",
    defaultValue: 3072,
  },
  {
    id: "answers-coding",
    secretId: "groq-admin",
    label: "Coding answers",
    defaultValue: 8192,
  },
]);

function defById(id) {
  return LLM_BUDGET_DEFS.find((row) => row.id === String(id || "").trim()) || null;
}

function clampBudget(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < MIN_TOKENS || n > MAX_TOKENS) return fallback;
  return n;
}

async function readStored() {
  try {
    const stored = await getJSON(REDIS_KEY);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return stored;
  } catch {
    return {};
  }
}

export async function researchLlmOptions(extra = {}) {
  return {
    apiKeySlot: "web_search",
    reasoning_effort: "low",
    include_reasoning: false,
    max_completion_tokens: await getLlmBudget("research"),
    ...extra,
  };
}

export async function getLlmBudget(id) {
  const def = defById(id);
  if (!def) return 4096;
  const stored = await readStored();
  return clampBudget(stored[def.id], def.defaultValue);
}

export async function listLlmBudgets() {
  const stored = await readStored();
  return LLM_BUDGET_DEFS.map((def) => ({
    id: def.id,
    secretId: def.secretId,
    label: def.label,
    value: clampBudget(stored[def.id], def.defaultValue),
    min: MIN_TOKENS,
    max: MAX_TOKENS,
    defaultValue: def.defaultValue,
  }));
}

export async function setLlmBudget(id, value) {
  const def = defById(id);
  if (!def) {
    const error = new Error("That token budget cannot be changed here.");
    error.status = 400;
    throw error;
  }
  const nextValue = clampBudget(value, NaN);
  if (!Number.isInteger(nextValue)) {
    const error = new Error(`Token budget must be a whole number from ${MIN_TOKENS} to ${MAX_TOKENS}.`);
    error.status = 400;
    throw error;
  }
  const stored = await readStored();
  const next = { ...stored, [def.id]: nextValue };
  const ok = await setJSON(REDIS_KEY, next);
  if (!ok) {
    const error = new Error("The token budget could not be saved.");
    error.status = 500;
    throw error;
  }
  return {
    id: def.id,
    secretId: def.secretId,
    label: def.label,
    value: nextValue,
    min: MIN_TOKENS,
    max: MAX_TOKENS,
    defaultValue: def.defaultValue,
  };
}
