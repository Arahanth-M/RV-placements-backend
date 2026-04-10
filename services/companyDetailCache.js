import redis from "../utils/redis.js";

export function companyDetailRedisKey(companyId) {
  if (companyId == null || companyId === "") return null;
  const id =
    typeof companyId === "object" && companyId !== null && "toString" in companyId
      ? companyId.toString()
      : String(companyId);
  if (!id || id === "undefined") return null;
  return `company:${id}`;
}

/**
 * Drop cached payload for GET /api/companies/:id so the next read rebuilds from MongoDB.
 * Safe if Redis is down or REDIS_URL unset (redis client no-ops or errors are swallowed).
 */
export async function invalidateCompanyDetailCache(companyId) {
  const key = companyDetailRedisKey(companyId);
  if (!key) return;
  try {
    await redis.del(key);
  } catch {
    // Optional cache — ignore failures
  }
}
