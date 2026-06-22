/**
 * Read-through cache for public GET /api/placement-stats/:year
 */
import PlacementGeneralStats from "../models/PlacementGeneralStats.js";
import { redisUrl } from "../src/utils/redisClient.js";
import { getJSON, setJSON, deleteKey, deleteKeysByPrefix } from "../src/utils/redisHelpers.js";
import {
  GENERAL_STATS_YEARS,
  DEFAULT_GENERAL_STATS_YEAR,
} from "../utils/generalStatsYears.js";
import { serializeGeneralStatsDoc } from "./placementGeneralStatsImportService.js";
import { attachBusinessModelStats } from "./placementBusinessModelStatsService.js";

const KEY_PREFIX = "rv:placement-general-stats:v2:";
const TTL_SECONDS = 3600;

function cacheKeyForYear(year) {
  return `${KEY_PREFIX}y:${year}`;
}

function isValidStatsPayload(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof value.year !== "number") return false;
  if (typeof value.totalOffers !== "number") return false;
  if (!value.kpis || typeof value.kpis !== "object") return false;
  if (!Array.isArray(value.byDepartment)) return false;
  if (!Array.isArray(value.ctcDistribution)) return false;
  if (!Array.isArray(value.topCompanies)) return false;
  if (!Array.isArray(value.monthlyTimeline)) return false;
  if (!Array.isArray(value.departmentAvgCtc)) return false;
  return true;
}

/**
 * @param {number} year
 */
export async function getGeneralStatsByYearFromDb(year) {
  const doc = await PlacementGeneralStats.findOne({ year }).lean();
  return serializeGeneralStatsDoc(doc);
}

function stripCachedBusinessModelFields(stats) {
  if (!stats || typeof stats !== "object") return stats;
  const {
    businessModelSummary: _a,
    businessModelByDepartment: _b,
    businessModelMeta: _c,
    byBusinessModel: _d,
    ...base
  } = stats;
  return base;
}

/**
 * @param {number} year
 */
export async function getGeneralStatsByYear(year) {
  let base;
  if (!redisUrl) {
    base = await getGeneralStatsByYearFromDb(year);
  } else {
    const key = cacheKeyForYear(year);
    const cached = await getJSON(key);
    if (isValidStatsPayload(cached)) {
      base = stripCachedBusinessModelFields(cached);
    } else {
      base = await getGeneralStatsByYearFromDb(year);
      if (base) {
        await setJSON(key, base, TTL_SECONDS);
      }
    }
  }

  return base ? attachBusinessModelStats(base) : null;
}

export async function listGeneralStatsMeta() {
  const docs = await PlacementGeneralStats.find(
    {},
    { year: 1, totalOffers: 1, updatedAt: 1, uploadedBy: 1, sourceFileName: 1 }
  )
    .sort({ year: -1 })
    .lean();

  const availableYears = docs.map((d) => d.year);
  const defaultYear = availableYears.includes(DEFAULT_GENERAL_STATS_YEAR)
    ? DEFAULT_GENERAL_STATS_YEAR
    : availableYears[0] ?? DEFAULT_GENERAL_STATS_YEAR;

  return {
    years: [...GENERAL_STATS_YEARS],
    availableYears,
    defaultYear,
    uploads: docs.map((d) => ({
      year: d.year,
      totalOffers: d.totalOffers,
      lastUpdatedAt: d.updatedAt,
      uploadedBy: d.uploadedBy || "",
      sourceFileName: d.sourceFileName || "",
    })),
  };
}

export async function invalidateGeneralStatsCache(year) {
  if (!redisUrl) {
    return { deleted: 0, skippedNoRedis: true };
  }
  if (year != null) {
    await deleteKey(cacheKeyForYear(year));
    return { deleted: 1 };
  }
  return deleteKeysByPrefix(KEY_PREFIX);
}
