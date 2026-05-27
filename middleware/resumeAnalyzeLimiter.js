import crypto from "crypto";
import redisClient, { redisUrl } from "../src/utils/redisClient.js";

const DEFAULT_MINUTE_LIMIT = 10;
const DEFAULT_DAY_LIMIT = 100;
const DEFAULT_KEY_PREFIX = "rv:resume:ats_analysis:rate";

function sha256(input) {
  return crypto.createHash("sha256").update(String(input ?? "")).digest("hex");
}

function getUserKey(req) {
  // Router already applies authJWT + authorize, so req.user should exist.
  // We intentionally prefer non-PII-ish identifiers; email is still used as fallback.
  const email = req?.user?.email;
  if (typeof email === "string" && email.trim()) return `email:${email.trim().toLowerCase()}`;
  if (req?.user?.userId) return `userId:${String(req.user.userId)}`;
  if (req?.user?._id) return `_id:${String(req.user._id)}`;
  return `ip:${req?.ip || ""}`;
}

function floorToBucket(nowMs, bucketMs) {
  return Math.floor(nowMs / bucketMs);
}

function secondsUntil(tsMs, nowMs = Date.now()) {
  const s = Math.ceil((tsMs - nowMs) / 1000);
  return Math.max(0, s);
}

function bucketEndMsForMinute(nowMs) {
  // Bucket aligned to UTC minute boundaries based on epoch minutes.
  const bucket = floorToBucket(nowMs, 60_000);
  return (bucket + 1) * 60_000;
}

function bucketEndMsForDay(nowMs) {
  const dayBucket = floorToBucket(nowMs, 86_400_000); // UTC day bucket by epoch division
  return (dayBucket + 1) * 86_400_000;
}

export function createInMemoryCounters() {
  /**
   * @type {Map<string, { minute: { bucket: number, count: number }, day: { bucket: number, count: number } }>}
   */
  const store = new Map();

  function getEntry(userKey) {
    let entry = store.get(userKey);
    if (!entry) {
      entry = {
        minute: { bucket: -1, count: 0 },
        day: { bucket: -1, count: 0 },
      };
      store.set(userKey, entry);
    }
    return entry;
  }

  return {
    /**
     * @param {string} userKey
     * @param {number} minuteLimit
     * @param {number} dayLimit
     * @param {number} nowMs
     */
    checkAndIncrement({ userKey, minuteLimit, dayLimit, nowMs }) {
      const minuteBucket = floorToBucket(nowMs, 60_000);
      const dayBucket = floorToBucket(nowMs, 86_400_000);

      const entry = getEntry(userKey);

      if (entry.minute.bucket !== minuteBucket) {
        entry.minute.bucket = minuteBucket;
        entry.minute.count = 0;
      }

      if (entry.day.bucket !== dayBucket) {
        entry.day.bucket = dayBucket;
        entry.day.count = 0;
      }

      // Increment first, then enforce (same semantics as express-rate-limit: allow up to `limit`).
      entry.minute.count += 1;
      entry.day.count += 1;

      const minuteExceeded = entry.minute.count > minuteLimit;
      const dayExceeded = entry.day.count > dayLimit;

      const exceeded = minuteExceeded || dayExceeded;
      if (!exceeded) {
        return { exceeded: false, minuteCount: entry.minute.count, dayCount: entry.day.count };
      }

      // We purposely compute Retry-After based on the soonest bucket end among exceeded windows.
      const minuteEnd = bucketEndMsForMinute(nowMs);
      const dayEnd = bucketEndMsForDay(nowMs);
      const minuteRetryAfter = secondsUntil(minuteEnd, nowMs);
      const dayRetryAfter = secondsUntil(dayEnd, nowMs);

      const retryAfterSeconds = Math.min(
        minuteExceeded ? minuteRetryAfter : Number.POSITIVE_INFINITY,
        dayExceeded ? dayRetryAfter : Number.POSITIVE_INFINITY
      );

      return {
        exceeded: true,
        minuteCount: entry.minute.count,
        dayCount: entry.day.count,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 0,
      };
    },
  };
}

const defaultInMemoryCounters = createInMemoryCounters();

/**
 * Redis-backed + in-memory fallback rate limiter for ATS analysis.
 *
 * @param {{
 *  minuteLimit?: number,
 *  dayLimit?: number,
 *  keyPrefix?: string,
 *  redisClient?: import("redis").RedisClientType,
 *  redisUrl?: string,
 *  now?: () => number,
 *  getUserKey?: (req: any) => string,
 *  inMemory?: ReturnType<typeof createInMemoryCounters>
 * }} [options]
 */
export function createResumeAnalyzeLimiter(options = {}) {
  const minuteLimit = Number.isFinite(options.minuteLimit) ? options.minuteLimit : DEFAULT_MINUTE_LIMIT;
  const dayLimit = Number.isFinite(options.dayLimit) ? options.dayLimit : DEFAULT_DAY_LIMIT;
  const keyPrefix = options.keyPrefix || DEFAULT_KEY_PREFIX;
  const now = options.now || (() => Date.now());
  const getUserKeyFn = options.getUserKey || getUserKey;
  const memory = options.inMemory || defaultInMemoryCounters;
  const client = options.redisClient || redisClient;
  const url = options.redisUrl !== undefined ? options.redisUrl : redisUrl;
  const useRedis = Boolean(url);

  /**
   * @returns {Promise<null | { exceeded: boolean, retryAfterSeconds?: number }>}
   */
  async function tryRedis({ userKeyHash, nowMs }) {
    if (!useRedis) return null;

    const minuteBucket = floorToBucket(nowMs, 60_000);
    const dayBucket = floorToBucket(nowMs, 86_400_000);

    const minuteKey = `${keyPrefix}:minute:${userKeyHash}:${minuteBucket}`;
    const dayKey = `${keyPrefix}:day:${userKeyHash}:${dayBucket}`;

    // TTLs based on bucket end. Keys embed bucket; TTL keeps Redis clean.
    const minuteEnd = bucketEndMsForMinute(nowMs);
    const dayEnd = bucketEndMsForDay(nowMs);
    const minuteTtlSeconds = secondsUntil(minuteEnd, nowMs);
    const dayTtlSeconds = secondsUntil(dayEnd, nowMs);

    const [minuteCountAfterIncr, dayCountAfterIncr] = await Promise.all([
      client.incr(minuteKey),
      client.incr(dayKey),
    ]);

    // Set expiries only when the bucket keys are first created (best-effort).
    if (minuteCountAfterIncr === 1 && minuteTtlSeconds > 0) {
      client.expire(minuteKey, minuteTtlSeconds).catch(() => {});
    }
    if (dayCountAfterIncr === 1 && dayTtlSeconds > 0) {
      client.expire(dayKey, dayTtlSeconds).catch(() => {});
    }

    const minuteExceeded = Number(minuteCountAfterIncr) > minuteLimit;
    const dayExceeded = Number(dayCountAfterIncr) > dayLimit;

    if (!minuteExceeded && !dayExceeded) {
      return { exceeded: false };
    }

    const minuteRetryAfter = minuteExceeded ? minuteTtlSeconds : Number.POSITIVE_INFINITY;
    const dayRetryAfter = dayExceeded ? dayTtlSeconds : Number.POSITIVE_INFINITY;
    const retryAfterSeconds = Math.min(minuteRetryAfter, dayRetryAfter);

    return {
      exceeded: true,
      retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 0,
    };
  }

  return async function resumeAnalyzeLimiter(req, res, next) {
    const userKey = getUserKeyFn(req);
    const userKeyHash = sha256(userKey);
    const nowMs = now();

    try {
      const redisResult = await tryRedis({ userKeyHash, nowMs });
      if (redisResult) {
        if (redisResult.exceeded) {
          const retryAfterSeconds = redisResult.retryAfterSeconds ?? 0;
          if (retryAfterSeconds > 0) res.setHeader("Retry-After", String(retryAfterSeconds));
          console.warn("[resume] ATS analysis rate limited", {
            window: "redis",
            retryAfterSeconds,
          });
          return res.status(429).json({
            error: "Too many analysis requests. Please try again later.",
          });
        }
        return next();
      }
    } catch {
      // Graceful degradation: Redis failures should never break analysis or requests.
    }

    // In-memory fallback
    const memResult = memory.checkAndIncrement({
      userKey: userKeyHash,
      minuteLimit,
      dayLimit,
      nowMs,
    });

    if (memResult.exceeded) {
      const retryAfterSeconds = memResult.retryAfterSeconds ?? 0;
      if (retryAfterSeconds > 0) res.setHeader("Retry-After", String(retryAfterSeconds));
      console.warn("[resume] ATS analysis rate limited", {
        window: "memory",
        retryAfterSeconds,
      });
      return res.status(429).json({
        error: "Too many analysis requests. Please try again later.",
      });
    }

    return next();
  };
}

export default createResumeAnalyzeLimiter();

