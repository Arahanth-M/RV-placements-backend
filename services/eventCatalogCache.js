/**
 * Read-through cache for GET /api/events (shared catalog for all users).
 * - Hit: return cached event list JSON (no MongoDB).
 * - Miss: route loads DB, then setCachedEventCatalog().
 * - Admin POST/PUT/DELETE invalidate so the next list fetch is fresh.
 * TTL is a safety net if invalidation is missed.
 */
import Event from "../models/Event.js";
import "../models/User1.js";
import { redisUrl } from "../src/utils/redisClient.js";
import { getJSON, setJSON, deleteKey } from "../src/utils/redisHelpers.js";

/** Bump when GET /api/events response shape changes. */
const CACHE_KEY = "rv:events:catalog:v1";
/** Seconds; aligns with other student/event caches */
const TTL_SECONDS = 900;

/**
 * Same query as GET /api/events — stored in Redis as plain JSON.
 * @returns {Promise<object[]>}
 */
export async function loadEventsCatalogFromDb() {
  return Event.find()
    .sort({ lastDateToRegister: 1, createdAt: -1 })
    .populate("createdBy", "username email")
    .select("-__v")
    .lean();
}

/**
 * @returns {Promise<object[] | null>}
 */
export async function getCachedEventCatalog() {
  if (!redisUrl) return null;
  const raw = await getJSON(CACHE_KEY);
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.events)) return null;
  return raw.events;
}

/**
 * @param {object[]} events
 */
export async function setCachedEventCatalog(events) {
  if (!redisUrl) return;
  const list = Array.isArray(events) ? events : [];
  await setJSON(CACHE_KEY, { events: list }, TTL_SECONDS);
}

export async function invalidateEventCatalogCache() {
  if (!redisUrl) {
    return { deleted: 0, skippedNoRedis: true };
  }
  const ok = await deleteKey(CACHE_KEY);
  return { deleted: ok ? 1 : 0 };
}
