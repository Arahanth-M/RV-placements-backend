import User1 from "../models/User1.js";
import Submission from "../models/Submission.js";
import CompanyVisit from "../models/CompanyVisit.js";
import {
  COMPANY_VISIT_YEAR,
  countAdminListableCompanyVisits,
} from "./companyService.js";
import { redisUrl } from "../src/utils/redisClient.js";
import { getJSON, setJSON, deleteKey } from "../src/utils/redisHelpers.js";

const CACHE_KEY = "rv:admin:dashboard:stats";
const TTL_SECONDS = 60;

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

export async function computeAdminDashboardStats() {
  const [
    totalUsers,
    totalSubmissions,
    pendingSubmissions,
    approvedSubmissions,
    totalCompanies,
    pendingCompanies,
  ] = await Promise.all([
    User1.countDocuments(),
    Submission.countDocuments(),
    Submission.countDocuments({ status: "pending" }),
    Submission.countDocuments({ status: "approved" }),
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
  };
}

/**
 * Cached dashboard stats for GET /api/admin/stats. Falls back to MongoDB if Redis is unset or errors.
 */
export async function getAdminDashboardStats() {
  if (!redisUrl) {
    return computeAdminDashboardStats();
  }

  const cached = await getJSON(CACHE_KEY);
  if (isValidStatsPayload(cached)) {
    return cached;
  }

  const fresh = await computeAdminDashboardStats();
  await setJSON(CACHE_KEY, fresh, TTL_SECONDS);
  return fresh;
}

/**
 * Call after admin actions that change submission or company counts shown on the dashboard.
 */
export async function invalidateAdminDashboardStatsCache() {
  if (!redisUrl) return;
  await deleteKey(CACHE_KEY);
}
