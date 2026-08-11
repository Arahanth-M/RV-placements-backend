import User1 from "../models/User1.js";
import Submission from "../models/Submission.js";
import CompanyVisit from "../models/CompanyVisit.js";
import {
  COMPANY_VISIT_YEAR,
  countAdminListableCompanyVisits,
} from "./companyService.js";
import { redisUrl } from "../src/utils/redisClient.js";
import { getJSON, setJSON, deleteKey, deleteKeysByPrefix } from "../src/utils/redisHelpers.js";
import {
  DEFAULT_COLLEGE_ID,
  normalizeCollegeId,
  withCollegeEmailScope,
} from "../utils/collegeScope.js";

const CACHE_KEY_PREFIX = "rv:admin:dashboard:stats:";
const CACHE_KEY_LEGACY = "rv:admin:dashboard:stats";
const TTL_SECONDS = 60;

function cacheKeyForCollege(collegeIdRaw) {
  const collegeId = normalizeCollegeId(collegeIdRaw);
  return `${CACHE_KEY_PREFIX}${collegeId}`;
}

function isValidStatsPayload(value) {
  if (!value || typeof value !== "object") return false;
  const keys = [
    "totalUsers",
    "totalSubmissions",
    "pendingSubmissions",
    "approvedSubmissions",
    "totalCompanies",
    "pendingCompanies",
  ];
  return keys.every((k) => typeof value[k] === "number");
}

/**
 * Lightweight admin counts (college-scoped people metrics; shared company catalog).
 * @param {unknown} [collegeIdRaw]
 */
export async function computeAdminDashboardStats(collegeIdRaw = null) {
  const collegeId = normalizeCollegeId(collegeIdRaw ?? DEFAULT_COLLEGE_ID);
  const userMatch = withCollegeEmailScope({}, collegeId, "email");
  const submissionMatch = (extra = {}) =>
    withCollegeEmailScope(extra, collegeId, "submittedBy.email");

  const [
    totalUsers,
    totalSubmissions,
    pendingSubmissions,
    approvedSubmissions,
    totalCompanies,
    pendingCompanies,
  ] = await Promise.all([
    User1.countDocuments(userMatch),
    Submission.countDocuments(submissionMatch()),
    Submission.countDocuments(submissionMatch({ status: "pending" })),
    Submission.countDocuments(submissionMatch({ status: "approved" })),
    CompanyVisit.countDocuments({ year: COMPANY_VISIT_YEAR, status: "approved" }),
    countAdminListableCompanyVisits("pending"),
  ]);

  return {
    totalUsers,
    totalSubmissions,
    pendingSubmissions,
    approvedSubmissions,
    totalCompanies,
    pendingCompanies,
    collegeId,
  };
}

/**
 * Cached dashboard stats. Falls back to MongoDB if Redis is unset or errors.
 * @param {unknown} [collegeIdRaw]
 */
export async function getAdminDashboardStats(collegeIdRaw = null) {
  const collegeId = normalizeCollegeId(collegeIdRaw ?? DEFAULT_COLLEGE_ID);
  if (!redisUrl) {
    return computeAdminDashboardStats(collegeId);
  }

  const key = cacheKeyForCollege(collegeId);
  const cached = await getJSON(key);
  if (isValidStatsPayload(cached)) {
    return cached;
  }

  const fresh = await computeAdminDashboardStats(collegeId);
  await setJSON(key, fresh, TTL_SECONDS);
  return fresh;
}

/**
 * Call after admin actions that change submission or company counts shown on the dashboard.
 */
export async function invalidateAdminDashboardStatsCache() {
  if (!redisUrl) return;
  await deleteKey(CACHE_KEY_LEGACY);
  await deleteKeysByPrefix(CACHE_KEY_PREFIX);
}
