/**
 * Engaged-time tracking for DAU rows.
 * Redis buffers heartbeats; Mongo only gets optional $inc activeMs (no identity rewrite).
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

function redisReady() {
  return Boolean(redisUrl) && redis.isOpen === true;
}

function resolveUserId(user) {
  return String(user?._id || user?.id || "").trim();
}

async function flushPendingToMongo(user, dayKey) {
  const userId = resolveUserId(user);
  if (!userId || !dayKey || !redisReady()) return 0;
  const key = pendingActiveKey(dayKey, userId);
  let raw;
  try {
    if (typeof redis.getDel === "function") {
      raw = await redis.getDel(key);
    } else {
      raw = await redis.get(key);
      if (raw != null) await redis.del(key);
    }
  } catch {
    return 0;
  }
  const ms = Math.floor(Number(raw) || 0);
  if (ms <= 0) return 0;

  try {
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
    return ms;
  } catch (err) {
    try {
      await redis.incrBy(key, ms);
      await redis.expire(key, REDIS_KEY_TTL_SECONDS);
    } catch {
      // pending already removed; restore failed
    }
    console.warn("[dau] activeMs flush failed", err?.message || err);
    return 0;
  }
}

/**
 * Buffer a heartbeat in Redis. Flushes to Mongo when pending ≥ 3 min or flush=true.
 * If Redis is down, skips entirely (no Mongo write on every ping).
 */
export async function recordHeartbeat(user, extras = {}) {
  if (!redisReady()) return { ok: false, skipped: true };
  const userId = resolveUserId(user);
  if (!userId) return { ok: false, skipped: true };

  const now = extras.at instanceof Date ? extras.at : extras.at ? new Date(extras.at) : new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return { ok: false, skipped: true };
  const dayKey = utcDayKey(now);
  const flush = extras.flush === true;

  try {
    const dayStateKey = heartbeatDayKey(userId);
    const prevDay = await redis.get(dayStateKey);
    if (prevDay && prevDay !== dayKey) {
      await flushPendingToMongo(user, prevDay);
    }
    await redis.set(dayStateKey, dayKey, { EX: REDIS_KEY_TTL_SECONDS });

    const lastKey = heartbeatLastKey(userId);
    const lastRaw = await redis.get(lastKey);
    const credit = creditHeartbeatMs({
      deltaMs: extras.deltaMs,
      lastAcceptedAt: lastRaw,
      now: nowMs,
    });

    const pendingKey = pendingActiveKey(dayKey, userId);
    if (credit > 0) {
      await redis.set(lastKey, String(nowMs), { EX: REDIS_KEY_TTL_SECONDS });
      await redis.incrBy(pendingKey, credit);
      await redis.expire(pendingKey, REDIS_KEY_TTL_SECONDS);
    }

    const pending = Math.floor(Number(await redis.get(pendingKey)) || 0);
    if (flush || pending >= HEARTBEAT_FLUSH_THRESHOLD_MS) {
      await flushPendingToMongo(user, dayKey);
    }

    return { ok: true, credit, skipped: false };
  } catch (err) {
    console.warn("[dau] heartbeat redis failed", err?.message || err);
    return { ok: false, skipped: true };
  }
}

export function recordHeartbeatSafe(user, extras = {}) {
  void recordHeartbeat(user, extras).catch((err) => {
    console.warn("[dau] heartbeat failed", err?.message || err);
  });
}

/** Pending Redis ms for many users on one day. Empty if Redis is down. */
export async function getPendingActiveMsMap(dayKey, userIds) {
  const ids = Array.isArray(userIds)
    ? userIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const map = new Map();
  if (!dayKey || ids.length === 0 || !redisReady()) return map;
  const unique = [...new Set(ids)];
  try {
    const keys = unique.map((id) => pendingActiveKey(dayKey, id));
    const values = await redis.mGet(keys);
    unique.forEach((id, i) => {
      const n = Math.floor(Number(values?.[i]) || 0);
      if (n > 0) map.set(id, n);
    });
  } catch (err) {
    console.warn("[dau] pending activeMs read failed", err?.message || err);
  }
  return map;
}
