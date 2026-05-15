/**
 * Read-through cache for GET /api/submissions/mine (keyed by submitter login email).
 * - Hit: return cached payload (no MongoDB).
 * - Miss: route loads DB, then setCachedMySubmissions().
 * Invalidate via invalidateMySubmissionsCacheByEmail when submissions are created, edited,
 * approved, rejected, or deleted.
 * TTL is a safety net if a write path forgets to invalidate.
 */
import { redisUrl } from "../src/utils/redisClient.js";
import { getJSON, setJSON, deleteKey } from "../src/utils/redisHelpers.js";

const KEY_PREFIX = "rv:student:my_submissions:";
/** Seconds; aligns with student profile / event registration cache safety TTL */
const TTL_SECONDS = 900;

export function normalizeSubmitterEmail(email) {
  if (email == null || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

function redisKeyForEmail(email) {
  const e = normalizeSubmitterEmail(email);
  if (!e) return null;
  return `${KEY_PREFIX}${e}`;
}

/**
 * @param {string} email
 * @returns {Promise<{ submissions: object[] } | null>}
 */
export async function getCachedMySubmissions(email) {
  if (!redisUrl) return null;
  const key = redisKeyForEmail(email);
  if (!key) return null;
  const raw = await getJSON(key);
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.submissions)) return null;
  return { submissions: raw.submissions };
}

/**
 * @param {string} email
 * @param {{ submissions: object[] }} payload
 */
export async function setCachedMySubmissions(email, payload) {
  if (!redisUrl) return;
  const key = redisKeyForEmail(email);
  if (!key) return;
  const submissions = Array.isArray(payload?.submissions) ? payload.submissions : [];
  await setJSON(key, { submissions }, TTL_SECONDS);
}

/**
 * @param {string} email
 */
export async function invalidateMySubmissionsCacheByEmail(email) {
  if (!redisUrl) {
    return { deleted: 0, skippedNoRedis: true };
  }
  const key = redisKeyForEmail(email);
  if (!key) return { deleted: 0 };
  const ok = await deleteKey(key);
  return { deleted: ok ? 1 : 0 };
}

/**
 * @param {{ submittedBy?: { email?: string } } | null | undefined} submission
 */
export function submitterEmailFromSubmission(submission) {
  return normalizeSubmitterEmail(submission?.submittedBy?.email);
}
