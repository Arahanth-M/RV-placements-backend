import redis, { redisUrl } from "../src/utils/redisClient.js";
import { addToSet, deleteKey, getJSON, getSetMembers, setJSON } from "../src/utils/redisHelpers.js";

const SUMMARY_TTL_SECONDS = 30;
const DETAIL_TTL_SECONDS = 120;
const SUMMARY_INDEX_TTL_SECONDS = 24 * 60 * 60;
const PROCESSING_TTL_SECONDS = 5 * 60;

const metrics = {
  summaries: { hit: 0, miss: 0 },
  details: { hit: 0, miss: 0 },
};

const shouldUseRedis = () => Boolean(redisUrl);

const summaryKey = ({ userId, page, limit }) =>
  `interview:summaries:user:${String(userId)}:page:${Number(page)}:limit:${Number(limit)}`;
const summaryIndexKey = (userId) => `interview:summaries:user:${String(userId)}:keys`;
const detailKey = (sessionId) => `interview:detail:session:${String(sessionId)}`;
const processingKey = (sessionId) => `interview:processing:session:${String(sessionId)}`;

function logMetricsOccasionally() {
  const totalSummary = metrics.summaries.hit + metrics.summaries.miss;
  const totalDetails = metrics.details.hit + metrics.details.miss;
  const total = totalSummary + totalDetails;
  if (total === 0 || total % 50 !== 0) return;

  const summaryHitRate = totalSummary
    ? Math.round((metrics.summaries.hit / totalSummary) * 100)
    : 0;
  const detailsHitRate = totalDetails
    ? Math.round((metrics.details.hit / totalDetails) * 100)
    : 0;

  console.info("[interview-cache] hit-rate", {
    summaries: `${summaryHitRate}%`,
    details: `${detailsHitRate}%`,
    summaryTotals: metrics.summaries,
    detailTotals: metrics.details,
  });
}

export async function getCachedInterviewSummaries(userId, page, limit) {
  if (!shouldUseRedis()) return null;
  const key = summaryKey({ userId, page, limit });
  const cached = await getJSON(key);
  if (cached) {
    metrics.summaries.hit += 1;
    logMetricsOccasionally();
    return cached;
  }
  metrics.summaries.miss += 1;
  logMetricsOccasionally();
  return null;
}

export async function setCachedInterviewSummaries(userId, page, limit, payload) {
  if (!shouldUseRedis()) return false;
  const key = summaryKey({ userId, page, limit });
  const ok = await setJSON(key, payload, SUMMARY_TTL_SECONDS);
  if (ok) {
    await addToSet(summaryIndexKey(userId), key, SUMMARY_INDEX_TTL_SECONDS);
  }
  return ok;
}

export async function invalidateInterviewSummaries(userId) {
  if (!shouldUseRedis()) return;
  const indexKey = summaryIndexKey(userId);
  const keys = await getSetMembers(indexKey);
  if (keys.length > 0) {
    await Promise.all(keys.map((key) => deleteKey(key)));
  }
  await deleteKey(indexKey);
}

export async function getCachedInterviewDetail(sessionId) {
  if (!shouldUseRedis()) return null;
  const key = detailKey(sessionId);
  const cached = await getJSON(key);
  if (cached) {
    metrics.details.hit += 1;
    logMetricsOccasionally();
    return cached;
  }
  metrics.details.miss += 1;
  logMetricsOccasionally();
  return null;
}

export async function setCachedInterviewDetail(sessionId, payload) {
  if (!shouldUseRedis()) return false;
  return setJSON(detailKey(sessionId), payload, DETAIL_TTL_SECONDS);
}

export async function invalidateInterviewDetail(sessionId) {
  if (!shouldUseRedis()) return;
  await deleteKey(detailKey(sessionId));
}

export async function markInterviewProcessing(sessionId) {
  if (!shouldUseRedis()) return;
  try {
    await redis.set(processingKey(sessionId), "1", { EX: PROCESSING_TTL_SECONDS });
  } catch (error) {
    console.error("[interview-cache] failed to mark processing:", error?.message || error);
  }
}

export async function clearInterviewProcessing(sessionId) {
  if (!shouldUseRedis()) return;
  try {
    await redis.del(processingKey(sessionId));
  } catch (error) {
    console.error("[interview-cache] failed to clear processing:", error?.message || error);
  }
}

export async function isInterviewProcessing(sessionId) {
  if (!shouldUseRedis()) return false;
  try {
    const exists = await redis.exists(processingKey(sessionId));
    return exists === 1;
  } catch (error) {
    console.error("[interview-cache] failed to read processing:", error?.message || error);
    return false;
  }
}
