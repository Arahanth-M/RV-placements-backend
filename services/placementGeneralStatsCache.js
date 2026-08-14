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
      base = s