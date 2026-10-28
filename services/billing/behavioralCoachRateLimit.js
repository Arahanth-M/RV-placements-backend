import redis, { connectRedis, redisUrl } from "../../src/utils/redisClient.js";
import { BEHAVIORAL_COACH_HOURLY_LIMIT } from "../../config/billingPlans.js";

const KEY_PREFIX = "rvp:behavioral-coach:hourly";
const WINDOW_MS = 60 * 60 * 1000;

/** @type {Map<string, { bucket: number, count: number }>} */
const memoryCounters = new Map();

function hourBucket(nowMs = Date.now()) {
  return Math.floor(nowMs / WINDOW_MS);
}

function secondsUntilBucketEnd(bucket, nowMs = Date.now()) {
  const endMs = (bucket + 1) * WINDOW_MS;
  return Math.max(0, Math.ceil((endMs - nowMs) / 1000));
}

function memoryCheckAndIncrement(userId, limit, nowMs = Date.now()) {
  const bucket = hourBucket(nowMs);
  const key = String(userId);
  let entry = memoryCounters.get(key);
  if (!entry || entry.bucket !== bucket) {
    entry = { bucket, count: 0 };
    memoryCounters.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > limit) {
    return {
      allowed: false,
      count: entry.count,
      limit,
      retryAfterSec: secondsUntilBucketEnd(bucket, nowMs),
    };
  }
  return {
    allowed: true,
    count: entry.count,
    limit,
    retryAfterSec: 0,
  };
}

async function redisCheckAndIncrement(userId, limit, nowMs = Date.now()) {
  const bucket = hourBucket(nowMs);
  const key = `${KEY_PREFIX}:${userId}:${bucket}`;
  await connectRedis();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, Math.ceil(WINDOW_MS / 1000));
  }
  if (count > limit) {
    return {
      allowed: false,
      count,
      limit,
      retryAfterSec: secondsUntilBucketEnd(bucket, nowMs),
    };
  }
  return {
    allowed: true,
    count,
    limit,
    retryAfterSec: 0,
  };
}

/**
 * Fixed one-hour window: at most `BEHAVIORAL_COACH_HOURLY_LIMIT` question generations.
 * Uses Redis when available; falls back to in-memory counters.
 */
export async function checkBehavioralCoachHourlyLimit(userId, now = new Date()) {
  const id = String(userId || "").trim();
  const limit = BEHAVIORAL_COACH_HOURLY_LIMIT;
  if (!id) {
    return { allowed: false, count: 0, limit, retryAfterSec: 0 };
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const forceMemory = process.env.BEHAVIORAL_COACH_RATE_LIMIT_MEMORY === "1";
  if (redisUrl && !forceMemory) {
    try {
      return await redisCheckAndIncrement(id, limit, nowMs);
    } catch (err) {
      console.warn(
        "[behavioralCoach] hourly rate limit redis failed, using memory:",
        err?.message || err
      );
    }
  }
  return memoryCheckAndIncrement(id, limit, nowMs);
}

/** Test helper — clear in-memory counters. */
export function resetBehavioralCoachHourlyMemory() {
  memoryCounters.clear();
}
