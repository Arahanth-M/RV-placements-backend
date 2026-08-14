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
import {
  COLLEGE_ID_RVCE,
  COLLEGE_ID_RVITM,
  normalizeCollegeId,
} from "../utils/collegeScope.js";

const KEY_PREFIX = "rv:placement-general-stats:v3:";
const TTL_SECONDS = 3600;

function cacheKeyForYear(year, collegeIdRaw) {
  return `${KEY_PREFIX}y:${year}:c:${normalizeCollegeId(collegeIdRaw)}`;
}

/**
 * RVCE docs may predate `collegeId` (untagged). RVITM always requires an explicit tag.
 * @param {number} year
 * @param {unknown} collegeIdRaw
 */
export function mongoFilterForGeneralStats(year, collegeIdRaw) {
  const collegeId = normalizeCollegeId(collegeIdRaw);
  if (collegeId === COLLEGE_ID_RVITM) {
    return { year, collegeId: COLLEGE_ID_RVITM };
  }
  return {
    year,
    $or: [
      { collegeId: COLLEGE_ID_RVCE },
      { collegeId: { $exists: false } },
      { collegeId: null },
      { collegeId: "" },
    ],
  };
}

let indexesEnsured = false;
async function ensureGeneralStatsIndexes() {
  if (indexesEnsured) return;
  indexesEnsured = true;
  try {
    await PlacementGeneralStats.collection.dropIndex("year_1");
  } catch {
    // Old unique-year index may already be gone.
  }
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
 * @param {unknown} [collegeIdRaw]
 */
export async function getGeneralStatsByYearFromDb(year, collegeIdRaw = COLLEGE_ID_RVCE) {
  await ensureGeneralStatsIndexes();
  const doc = await PlacementGeneralStats.findOne(
    mongoFilterForGeneralStats(year, collegeIdRaw)
  ).lean();
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
 * @param {unknown} [collegeIdRaw]
 */
export async function getGeneralStatsByYear(year, collegeIdRaw = COLLEGE_ID_RVCE) {
  const collegeId = normalizeCollegeId(collegeIdRaw);
  let base;
  if (!redisUrl) {
    base = await getGeneralStatsByYearFromDb(year, collegeId);
  } else {
    const key = cacheKeyForYear(year, collegeId);
    const cached = await getJSON(key);
    if (isValidStatsPayload(cached)) {
      base = stripCachedBusinessModelFields(cached);
    } else {
      base = await getGeneralStatsByYearFromDb(year, collegeId);
      if (base) {
        await setJSON(key, base, TTL_SECONDS);
      }
    }
  }

  return base ? attachBusinessModelStats(base) : null;
}

/**
 * @param {unknown} [collegeIdRaw]
 */
export async function listGeneralStatsMeta(collegeIdRaw = COLLEGE_ID_RVCE) {
  await ensureGeneralStatsIndexes();
  const collegeId = normalizeCollegeId(collegeIdRaw);
  const match =
    collegeId === COLLEGE_ID_RVITM
      ? { collegeId: COLLEGE_ID_RVITM }
      : {
          $or: [
            { collegeId: COLLEGE_ID_RVCE },
            { collegeId: { $exists: false } },
            { collegeId: null },
            { collegeId: "" },
          ],
        };

  const docs = await PlacementGeneralStats.find(match, {
    year: 1,
    totalOffers: 1,
    updatedAt: 1,
    uploadedBy: 1,
    sourceFileName: 1,
  })
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

/**
 * @param {number} year
 * @param {unknown} collegeIdRaw
 * @param {Record<string, unknown>} docPayload
 */
export async function saveGeneralStatsForCollege(year, collegeIdRaw, docPayload) {
  await ensureGeneralStatsIndexes();
  const collegeId = normalizeCollegeId(collegeIdRaw);
  const existing = await PlacementGeneralStats.findOne(
    mongoFilterForGeneralStats(year, collegeId)
  );
  const nextPayload = { ...docPayload, year, collegeId };
  const saved = existing
    ? await PlacementGeneralStats.findByIdAndUpdate(
        existing._id,
        { $set: nextPayload },
        { new: true }
      ).lean()
    : (await PlacementGeneralStats.create(nextPayload)).toObject();
  await invalidateGeneralStatsCache(year, collegeId);
  return saved;
}

/**
 * @param {number|null|undefined} year
 * @param {unknown} [collegeIdRaw]
 */
export async function invalidateGeneralStatsCache(year, collegeIdRaw = null) {
  if (!redisUrl) {
    return { deleted: 0, skippedNoRedis: true };
  }
  if (year != null) {
    if (collegeIdRaw != null && String(collegeIdRaw).trim() !== "") {
      await deleteKey(cacheKeyForYear(year, collegeIdRaw));
      return { deleted: 1 };
    }
    await deleteKey(cacheKeyForYear(year, COLLEGE_ID_RVCE));
    await deleteKey(cacheKeyForYear(year, COLLEGE_ID_RVITM));
    await deleteKey(`rv:placement-general-stats:v2:y:${year}`);
    return { deleted: 3 };
  }
  return deleteKeysByPrefix(KEY_PREFIX);
}
