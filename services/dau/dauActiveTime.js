/**
 * Engaged-time tracking for DAU rows.
 * Redis buffers heartbeats when available; otherwise an in-process buffer is used.
 * Mongo only gets optional $inc activeMs (no identity rewrite).
 */

import redis, { redisUrl } from "../../src/utils/redisClient.js";
import DauDayUser from "../../models/DauDayUser.js";
import { utcDayKey } from "./recordDauActivity.js";
import {
  HEARTBEAT_FLUSH_THRESHOLD_MS,
  REDIS_KEY_TTL_SECONDS,
  activeMsFlushUpdate,
  creditHeartbeatMs,
  heartbeatDayKey,
  heartbeatLastKey,
  pendingActiveKey,
} from "./dauActiveTimePure.js";

export {
  MIN_HEARTBEAT_INTERVAL_MS,
  MAX_HEARTBEAT_DELTA_MS,
  HEARTBEAT_FLUSH_THRESHOLD_MS,
  REDIS_KEY_TTL_SECONDS,
  pendingActiveKey,
  heartbeatLastKey,
  heartbeatDayKey,
  clampHeartbeatDeltaMs,
  creditHeartbeatMs,
  formatActiveMsLabel,
  combineActiveMs,
  activeMsFlushUpdate,
} from "./dauActiveTimePure.js";

/** Fallback when REDIS_URL is missing or Redis is unreachable (e.g. backend-main without remote Redis). */
const memoryPending = new Map();
const memoryLastAt = new Map();
const memoryDay = new Map();

function redisReady() {
  return Boolean(redisUrl) && redis.isOpen === true;
}

function resolveUserId(user) {
  return String(user?._id || user?.userId || user?.id || "").trim();
}

async function incActiveMsOnDayUser(user, dayKey, ms) {
  const userId = resolveUserId(user);
  if (!userId || !dayKey || ms <= 0) return;
  await DauDayUser.updateOne(
    { dayKey, userId },
    activeMsFlushUpdate({
      userId,
      email: user.email,
      username: user.username,
      role: user.role,
      dayKey,
      now: new Date(),
      ms,
    }),
    { upsert: true, timestamps: false }
  );
}

async function readPendingMs(dayKey, userId) {
  const key = pendingActiveKey(dayKey, userId);
  if (redisReady()) {
    try {
      return Math.floor(Number(await redis.get(key)) || 0);
    } catch {
      return Math.floor(Number(memoryPending.get(key)) || 0);
    }
  }
  return Math.floor(Number(memoryPending.get(key)) || 0);
}

async function takePendingMs(dayKey, userId) {
  const key = pendingActiveKey(dayKey, userId);
  if (redisReady()) {
    let raw;
    try {
      if (typeof redis.getDel === "function") {
        raw = await redis.getDel(key);
      } else {
        raw = await redis.get(key);
        if (raw != null) await redis.del(key);
      }
    } catch {
      return Math.floor(Number(memoryPending.get(key)) || 0);
    }
    return Math.floor(Number(raw) || 0);
  }
  const ms = Math.floor(Number(memoryPending.get(key)) || 0);
  if (ms > 0) memoryPending.delete(key);
  return ms;
}

async function addPendingMs(dayKey, userId, credit) {
  const key = pendingActiveKey(dayKey, userId);
  if (redisReady()) {
    try {
      await redis.incrBy(key, credit);
      await redis.expire(key, REDIS_KEY_TTL_SECONDS);
      return;
    } catch {
      // fall through to memory
    }
  }
  memoryPending.set(key, Math.floor(Number(memoryPending.get(key)) || 0) + credit);
}

async function restorePendingMs(dayKey, userId, ms) {
  const key = pendingActiveKey(dayKey, userId);
  if (redisReady()) {
    try {
      await redis.incrBy(key, ms);
      await redis.expire(key, REDIS_KEY_TTL_SECONDS);
      return;
    } catch {
      // fall through
    }
  }
  memoryPending.set(key, Math.floor(Number(memoryPending.get(key)) || 0) + ms);
}

async function getLastAcceptedRaw(userId) {
  const lastKey = heartbeatLastKey(userId);
  if (redisReady()) {
    try {
      return await redis.get(lastKey);
    } catch {
      return memoryLastAt.get(lastKey) ?? null;
    }
  }
  return memoryLastAt.get(lastKey) ?? null;
}

async function setLastAccepted(userId, nowMs) {
  const lastKey = heartbeatLastKey(userId);
  if (redisReady()) {
    try {
      await redis.set(lastKey, String(nowMs), { EX: REDIS_KEY_TTL_SECONDS });
      return;
    } catch {
      // fall through
    }
  }
  memoryLastAt.set(lastKey, String(nowMs));
}

async function getUserDay(userId) {
  const dayStateKey = heartbeatDayKey(userId);
  if (redisReady()) {
    try {
      return await redis.get(dayStateKey);
    } catch {
      return memoryDay.get(dayStateKey) ?? null;
    }
  }
  return memoryDay.get(dayStateKey) ?? null;
}

async function setUserDay(userId, dayKey) {
  const dayStateKey = heartbeatDayKey(userId);
  if (redisReady()) {
    try {
      await redis.set(dayStateKey, dayKey, { EX: REDIS_KEY_TTL_SECONDS });
      return;
    } catch {
      // fall through
    }
  }
  memoryDay.set(dayStateKey, dayKey);
}

async function flushPendingToMongo(user, dayKey) {
  const userId = resolveUserId(user);
  if (!userId || !dayKey) return 0;
  const ms = await takePendingMs(dayKey, userId);
  if (ms <= 0) return 0;

  try {
    await incActiveMsOnDayUser(user, dayKey, ms);
    return ms;
  } catch (err) {
    await restorePendingMs(dayKey, userId, ms);
    console.warn("[dau] activeMs flush failed", err?.message || err);
    return 0;
  }
}

/**
 * Buffer a heartbeat. Flushes to Mongo when pending ≥ 3 min or flush=true.
 * Uses Redis when connected; otherwise buffers in-process and still flushes to Mongo.
 */
export async function recordHeartbeat(user, extras = {}) {
  const userId = resolveUserId(user);
  if (!userId) return { ok: false, skipped: true };

  const now = extras.at instanceof Date ? extras.at : extras.at ? new Date(extras.at) : new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return { ok: false, skipped: true };
  const dayKey = utcDayKey(now);
  const flush = extras.flush === true;

  try {
    const prevDay = await getUserDay(userId);
    if (prevDay && prevDay !== dayKey) {
      await flushPendingToMongo(user, prevDay);
    }
    await setUserDay(userId, dayKey);

    const lastRaw = await getLastAcceptedRaw(userId);
    const credit = creditHeartbeatMs({
      deltaMs: extras.deltaMs,
      lastAcceptedAt: lastRaw,
      now: nowMs,
    });

    if (credit > 0) {
      await setLastAccepted(userId, nowMs);
      await addPendingMs(dayKey, userId, credit);
    }

    const pending = await readPendingMs(dayKey, userId);
    if (flush || pending >= HEARTBEAT_FLUSH_THRESHOLD_MS) {
      await flushPendingToMongo(user, dayKey);
    }

    return { ok: true, credit, skipped: false };
  } catch (err) {
    console.warn("[dau] heartbeat failed", err?.message || err);
    return { ok: false, skipped: true };
  }
}

export function recordHeartbeatSafe(user, extras = {}) {
  void recordHeartbeat(user, extras).catch((err) => {
    console.warn("[dau] heartbeat failed", err?.message || err);
  });
}

/** Pending buffered ms for many users on one day (Redis or in-process fallback). */
export async function getPendingActiveMsMap(dayKey, userIds) {
  const ids = Array.isArray(userIds)
    ? userIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const map = new Map();
  if (!dayKey || ids.length === 0) return map;
  const unique = [...new Set(ids)];

  if (redisReady()) {
    try {
      const keys = unique.map((id) => pendingActiveKey(dayKey, id));
      const values = await redis.mGet(keys);
      unique.forEach((id, i) => {
        const n = Math.floor(Number(values?.[i]) || 0);
        if (n > 0) map.set(id, n);
      });
      return map;
    } catch (err) {
      console.warn("[dau] pending activeMs read failed", err?.message || err);
    }
  }

  unique.forEach((id) => {
    const key = pendingActiveKey(dayKey, id);
    const n = Math.floor(Number(memoryPending.get(key)) || 0);
    if (n > 0) map.set(id, n);
  });
  return map;
}
