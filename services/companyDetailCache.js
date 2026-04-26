import redis from "../utils/redis.js";

/** Must match `COMPANY_DETAIL_VISIT_YEARS` in companyService (detail cache keys per year). */
const DETAIL_CACHE_YEAR_SUFFIXES = ["2026", "2027"];

/**
 * @param {unknown} companyId
 * @param {number|string|null|undefined} placementYear resolved placement year (e.g. 2026)
 */
export function companyDetailRedisKey(companyId, placementYear) {
  if (companyId == null || companyId === "") return null;
  const id =
    typeof companyId === "object" && companyId !== null && "toString" in companyId
      ? companyId.toString()
      : String(companyId);
  if (!id || id === "undefined") return null;
  const y =
    placementYear == null || placementYear === ""
      ? "2026"
      : String(placementYear);
  return `company:${id}:y${y}`;
}

/**
 * Drop cached payload for GET /api/companies/:id so the next read rebuilds from MongoDB.
 * Safe if Redis is down or REDIS_URL unset (redis client no-ops or errors are swallowed).
 */
export async function invalidateCompanyDetailCache(companyId) {
  const id =
    companyId == null || companyId === ""
      ? null
      : typeof companyId === "object" && companyId !== null && "toString" in companyId
        ? companyId.toString()
        : String(companyId);
  if (!id || id === "undefined") return;
  const keys = [
    `company:${id}`,
    ...DETAIL_CACHE_YEAR_SUFFIXES.map((y) => `company:${id}:y${y}`),
  ];
  try {
    await redis.del(keys);
  } catch {
    // Optional cache — ignore failures
  }
}
