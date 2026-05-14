/**
 * Read-through cache for GET /api/events/me/registrations (keyed by student login email).
 * - Hit: return cached payload (no MongoDB).
 * - Miss: route loads DB, then setCachedEventRegistrations().
 * - POST /api/events/:id/register writes through so the list stays fresh without an extra read.
 * TTL is a safety net if a write path forgets to update the cache.
 */
import { redisUrl } from "../src/utils/redisClient.js";
import { getJSON, setJSON, deleteKey } from "../src/utils/redisHelpers.js";

const KEY_PREFIX = "rv:student:event_registrations:";
/** Seconds; aligns with student profile cache safety TTL */
const TTL_SECONDS = 900;

function normalizeEmail(email) {
  if (email == null || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

function redisKeyForEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  return `${KEY_PREFIX}${e}`;
}

/**
 * @param {string} email
 * @returns {Promise<{ registeredEventIds: string[] } | null>}
 */
export async function getCachedEventRegistrations(email) {
  if (!redisUrl) return null;
  const key = redisKeyForEmail(email);
  if (!key) return null;
  const raw = await getJSON(key);
  if (!raw || typeof raw !== "object") return null;
  const ids = raw.registeredEventIds;
  if (!Array.isArray(ids)) return null;
  return { registeredEventIds: ids.map((id) => String(id)) };
}

/**
 * @param {string} email
 * @param {{ registeredEventIds: string[] }} payload
 */
export async function setCachedEventRegistrations(email, payload) {
  if (!redisUrl) return;
  const key = redisKeyForEmail(email);
  if (!key) return;
  const ids = Array.isArray(payload?.registeredEventIds)
    ? payload.registeredEventIds.map((id) => String(id))
    : [];
  await setJSON(key, { registeredEventIds: ids }, TTL_SECONDS);
}

/**
 * @param {string} email
 */
export async function invalidateEventRegistrationsCacheByEmail(email) {
  if (!redisUrl) {
    return { deleted: 0, skippedNoRedis: true };
  }
  const key = redisKeyForEmail(email);
  if (!key) return { deleted: 0 };
  const ok = await deleteKey(key);
  return { deleted: ok ? 1 : 0 };
}
