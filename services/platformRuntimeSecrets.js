import { getJSON, setJSON } from "../src/utils/redisHelpers.js";

const REDIS_KEY = "platform:runtime-secrets";

export const RUNTIME_SECRET_DEFS = Object.freeze([
  {
    id: "groq-admin",
    envName: "GROQ_KEY_ADMIN",
    label: "Answers, enhance, and role titles",
    description: "Groq key for generating answers, enhancing questions, and choosing fresher roles.",
  },
  {
    id: "groq-web-search",
    envName: "GROQ_KEY_WEB_SEARCH",
    label: "Research questions and experiences",
    description: "Groq key that turns scraped pages into interview questions, OA questions, and experiences.",
  },
  {
    id: "tavily",
    envName: "TAVILY_API_KEY",
    label: "Web search",
    description: "Tavily key for company research and fresher-role suggestions.",
  },
]);

const originalEnv = new Map();
const overrides = new Map();

function defById(id) {
  return RUNTIME_SECRET_DEFS.find((row) => row.id === String(id || "").trim()) || null;
}

function rememberOriginal(envName) {
  if (!originalEnv.has(envName)) {
    originalEnv.set(envName, String(process.env[envName] || "").trim());
  }
}

function applyOverride(envName, value) {
  rememberOriginal(envName);
  overrides.set(envName, value);
  process.env[envName] = value;
}

function clearOverride(envName) {
  rememberOriginal(envName);
  overrides.delete(envName);
  const original = originalEnv.get(envName) || "";
  if (original) process.env[envName] = original;
  else delete process.env[envName];
}

export function maskSecret(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 4) return "••••";
  return `••••${text.slice(-4)}`;
}

function activeValue(envName) {
  const override = overrides.get(envName);
  if (typeof override === "string" && override.trim()) return override.trim();
  rememberOriginal(envName);
  return originalEnv.get(envName) || String(process.env[envName] || "").trim();
}

function publicRow(def, stored) {
  const override = typeof stored?.[def.envName] === "string" ? stored[def.envName].trim() : "";
  const active = override || activeValue(def.envName);
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    configured: Boolean(active),
    source: override ? "override" : active ? "env" : "missing",
    hint: maskSecret(active),
  };
}

async function readStored() {
  const stored = await getJSON(REDIS_KEY);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  return stored;
}

/**
 * Apply saved replacements onto this process. Safe to call on boot and before each research job.
 */
export async function loadRuntimeSecrets() {
  const stored = await readStored();
  for (const def of RUNTIME_SECRET_DEFS) {
    const value = stored[def.envName];
    if (typeof value === "string" && value.trim()) applyOverride(def.envName, value.trim());
  }
}

export async function listRuntimeSecrets() {
  const stored = await readStored();
  return RUNTIME_SECRET_DEFS.map((def) => publicRow(def, stored));
}

function reject(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertReplacement(value) {
  const text = String(value || "").trim();
  if (text.length < 16 || text.length > 400) {
    throw reject("Paste the full replacement key.", 400);
  }
  if (/[•*]/.test(text)) {
    throw reject("Paste the full key, not the masked value.", 400);
  }
  return text;
}

export async function setRuntimeSecret(id, value) {
  const def = defById(id);
  if (!def) throw reject("That key cannot be changed here.", 400);
  const text = assertReplacement(value);
  const stored = await readStored();
  const next = { ...stored, [def.envName]: text };
  const ok = await setJSON(REDIS_KEY, next);
  if (!ok) throw reject("The replacement key could not be saved.", 500);
  applyOverride(def.envName, text);
  return publicRow(def, next);
}

export async function clearRuntimeSecret(id) {
  const def = defById(id);
  if (!def) throw reject("That key cannot be changed here.", 400);
  const stored = await readStored();
  const next = { ...stored };
  delete next[def.envName];
  const ok = await setJSON(REDIS_KEY, next);
  if (!ok) throw reject("The server default could not be restored.", 500);
  clearOverride(def.envName);
  return publicRow(def, next);
}
