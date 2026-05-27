import crypto from "crypto";
import { redisUrl } from "../../../src/utils/redisClient.js";
import { getJSON, setJSON } from "../../../src/utils/redisHelpers.js";
import { SCORER_VERSION } from "./constants.js";

const TTL_SECONDS = 15 * 60;
const KEY_PREFIX = "rv:resume:ats_analysis:";

/**
 * Deterministic JSON stringify with sorted object keys.
 * Arrays preserve order.
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === null) return "null";

  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number" || t === "boolean") return String(value);
  if (t === "bigint") return JSON.stringify(value.toString());
  if (t === "undefined") return '"__undefined__"';
  if (value instanceof Date) return JSON.stringify(value.toISOString());

  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }

  if (t === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }

  // fallback: functions/symbols/etc
  return JSON.stringify(String(value));
}

/**
 * @param {{
 *   sanitizedResumePayload: object,
 *   scorerVersion?: string
 * }} args
 * @returns {string} cache key
 */
export function createAtsAnalysisCacheKey({
  sanitizedResumePayload,
  scorerVersion = SCORER_VERSION,
}) {
  const payloadString = stableStringify(sanitizedResumePayload);
  const inputString = `${payloadString}|${scorerVersion}`;

  const hash = crypto.createHash("sha256").update(inputString).digest("hex");
  return `${KEY_PREFIX}${hash}`;
}

/**
 * @param {string} cacheKey
 * @returns {Promise<object | null>}
 */
export async function getCachedAtsAnalysis(cacheKey) {
  if (!redisUrl) return null;
  if (!cacheKey) return null;

  try {
    const cached = await getJSON(cacheKey);
    return cached && typeof cached === "object" ? cached : null;
  } catch {
    // graceful degradation: cache should never fail the request
    return null;
  }
}

/**
 * @param {string} cacheKey
 * @param {object} analysis
 * @returns {Promise<boolean>}
 */
export async function setCachedAtsAnalysis(cacheKey, analysis) {
  if (!redisUrl) return false;
  if (!cacheKey) return false;

  try {
    return await setJSON(cacheKey, analysis, TTL_SECONDS);
  } catch {
    // graceful degradation
    return false;
  }
}

