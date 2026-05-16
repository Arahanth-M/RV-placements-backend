/**
 * Resolves which Groq API key this process should use.
 * Set all three keys in .env; each service picks one via GROQ_KEY_SLOT or entrypoint detection.
 */

export const GROQ_KEY_SLOTS = Object.freeze({
  ADMIN: "admin",
  INTERVIEW_API: "interview_api",
  INTERVIEW_WORKER: "interview_worker",
});

/** Env var names (values are the secret keys). */
export const GROQ_KEY_ENV_BY_SLOT = Object.freeze({
  [GROQ_KEY_SLOTS.ADMIN]: "GROQ_KEY_ADMIN",
  [GROQ_KEY_SLOTS.INTERVIEW_API]: "GROQ_KEY_INTERVIEW_API",
  [GROQ_KEY_SLOTS.INTERVIEW_WORKER]: "GROQ_KEY_INTERVIEW_WORKER",
});

const VALID_SLOTS = new Set(Object.values(GROQ_KEY_SLOTS));

const normalizeSlot = (value) => {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "interview-api") return GROQ_KEY_SLOTS.INTERVIEW_API;
  if (raw === "interview_worker" || raw === "interview-worker") {
    return GROQ_KEY_SLOTS.INTERVIEW_WORKER;
  }
  if (VALID_SLOTS.has(raw)) return raw;
  return null;
};

/**
 * Which key bucket this Node process should use.
 * Prefer GROQ_KEY_SLOT; otherwise infer from argv (server-main, server-interview, interviewWorker).
 */
export function detectGroqKeySlot() {
  const fromEnv = normalizeSlot(process.env.GROQ_KEY_SLOT);
  if (fromEnv) return fromEnv;

  const entry = String(process.argv[1] || "").replace(/\\/g, "/");
  if (entry.includes("workers/interviewWorker") || entry.includes("interviewWorker.js")) {
    return GROQ_KEY_SLOTS.INTERVIEW_WORKER;
  }
  if (entry.includes("server-interview")) {
    return GROQ_KEY_SLOTS.INTERVIEW_API;
  }
  if (entry.includes("server-main")) {
    return GROQ_KEY_SLOTS.ADMIN;
  }

  return null;
}

/**
 * @param {string | null | undefined} [slot] — defaults to detectGroqKeySlot()
 * @returns {string} Groq API key
 */
export function resolveGroqApiKey(slot) {
  const resolvedSlot = normalizeSlot(slot) || detectGroqKeySlot();
  if (resolvedSlot) {
    const envName = GROQ_KEY_ENV_BY_SLOT[resolvedSlot];
    const keyed = process.env[envName];
    if (typeof keyed === "string" && keyed.trim()) {
      return keyed.trim();
    }
    throw new Error(`Missing ${envName} environment variable.`);
  }

  const legacy = process.env.GROQ_API_KEY;
  if (typeof legacy === "string" && legacy.trim()) {
    return legacy.trim();
  }

  throw new Error(
    "Missing Groq API key. Set GROQ_KEY_ADMIN, GROQ_KEY_INTERVIEW_API, and GROQ_KEY_INTERVIEW_WORKER (with GROQ_KEY_SLOT), or legacy GROQ_API_KEY."
  );
}

export function getGroqKeyEnvName(slot) {
  const resolvedSlot = normalizeSlot(slot) || detectGroqKeySlot();
  if (resolvedSlot) return GROQ_KEY_ENV_BY_SLOT[resolvedSlot];
  return "GROQ_API_KEY";
}

export function isGroqConfigError(message) {
  const msg = String(message || "");
  return (
    msg.includes("Missing GROQ_KEY_") ||
    msg.includes("Missing GROQ_API_KEY") ||
    msg.includes("Missing Groq API key")
  );
}
