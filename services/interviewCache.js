/**
 * Redis-backed interview list/detail cache and a short-lived "processing" flag
 * so the API can avoid duplicate work and surface evaluation-in-flight state.
 * If Redis is unavailable, all operations no-op safely (cache miss; processing false).
 */
import redis, { connectRedis } from "../src/utils/redisClient.js";

const SUMMARY_TTL_SEC = 30;
const DETAIL_TTL_SEC = 120;
const ANALYTICS_TTL_SEC = 300;
const PROCESSING_TTL_SEC = 600;

const summaryKey = (userId, page, limit) =>
  `rvp:interview:summaries:${String(userId)}:${Number(page)}:${Number(limit)}`;

const detailKey = (sessionId) => `rvp:interview:detail:${String(sessionId)}`;

// v2: progress rows include role, rounds, round types, questions, readiness
const analyticsKey = (userId) => `rvp:interview:analytics:v2:${String(userId)}`;

const processingKey = (sessionId) => `rvp:interview:processing:${String(sessionId)}`;

async function getRedis() {
  if (!process.env.REDIS_URL) {
    return null;
  }
  try {
    await connectRedis();
    return redis;
  } catch {
    return null;
  }
}

export async function getCachedInterviewSummaries(userId, page, limit) {
  const r = await getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(summaryKey(userId, page, limit));
    if (!raw || typeof raw !== "string") return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setCachedInterviewSummaries(userId, page, limit, payload) {
  const r = await getRedis();
  if (!r) return;
  try {
    await r.set(summaryKey(userId, page, limit), JSON.stringify(payload), {
      EX: SUMMARY_TTL_SEC,
    });
  } catch (e) {
    console.warn("[interviewCache] setCachedInterviewSummaries:", e?.message || e);
  }
}

export async function invalidateInterviewSummaries(userId) {
  const r = await getRedis();
  if (!r) return;
  const pattern = `rvp:interview:summaries:${String(userId)}:*`;
  try {
    const keys = await r.keys(pattern);
    if (keys.length > 0) {
      await r.del(keys);
    }
  } catch (e) {
    console.warn("[interviewCache] invalidateInterviewSummaries:", e?.message || e);
  }
}

export async function getCachedInterviewDetail(sessionId) {
  const r = await getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(detailKey(sessionId));
    if (!raw || typeof raw !== "string") return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setCachedInterviewDetail(sessionId, payload) {
  const r = await getRedis();
  if (!r) return;
  try {
    await r.set(detailKey(sessionId), JSON.stringify(payload), {
      EX: DETAIL_TTL_SEC,
    });
  } catch (e) {
    console.warn("[interviewCache] setCachedInterviewDetail:", e?.message || e);
  }
}

export async function invalidateInterviewDetail(sessionId) {
  const r = await getRedis();
  if (!r) return;
  try {
    await r.del(detailKey(sessionId));
  } catch (e) {
    console.warn("[interviewCache] invalidateInterviewDetail:", e?.message || e);
  }
}

export async function getCachedInterviewAnalytics(userId) {
  const r = await getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(analyticsKey(userId));
    if (!raw || typeof raw !== "string") return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setCachedInterviewAnalytics(userId, payload) {
  const r = await getRedis();
  if (!r) return;
  try {
    await r.set(analyticsKey(userId), JSON.stringify(payload), {
      EX: ANALYTICS_TTL_SEC,
    });
  } catch (e) {
    console.warn("[interviewCache] setCachedInterviewAnalytics:", e?.message || e);
  }
}

export async function invalidateInterviewAnalytics(userId) {
  const r = await getRedis();
  if (!r) return;
  try {
    await r.del(analyticsKey(userId));
  } catch (e) {
    console.warn("[interviewCache] invalidateInterviewAnalytics:", e?.message || e);
  }
}

export async function markInterviewProcessing(sessionId) {
  const r = await getRedis();
  if (!r) return;
  try {
    await r.set(processingKey(sessionId), "1", { EX: PROCESSING_TTL_SEC });
  } catch (e) {
    console.warn("[interviewCache] markInterviewProcessing:", e?.message || e);
  }
}

export async function isInterviewProcessing(sessionId) {
  const r = await getRedis();
  if (!r) return false;
  try {
    const v = await r.get(processingKey(sessionId));
    return v === "1";
  } catch {
    return false;
  }
}

export async function clearInterviewProcessing(sessionId) {
  const r = await getRedis();
  if (!r) return;
  try {
    await r.del(processingKey(sessionId));
  } catch (e) {
    console.warn("[interviewCache] clearInterviewProcessing:", e?.message || e);
  }
}
