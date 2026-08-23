import User1 from "../models/User1.js";
import Submission from "../models/Submission.js";
import CompanyStatic from "../models/CompanyStatic.js";
import CompanyVisit from "../models/CompanyVisit.js";
import {
  COMPANY_VISIT_YEAR,
  countAdminListableCompanyVisits,
} from "../services/companyService.js";
import {
  getDauCountForDay,
  getDauTrendSeries,
  utcDayKey,
} from "../services/admin/adminDauService.js";
import {
  collegeIdFromUser,
  normalizeCollegeId,
  withCollegeEmailScope,
} from "../utils/collegeScope.js";

function startOfDay(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildDateRangeMap(days) {
  const todayStart = startOfDay(new Date());
  const start = addDays(todayStart, -(days - 1));
  const map = new Map();

  for (let index = 0; index < days; index += 1) {
    const current = addDays(start, index);
    const key = current.toISOString().slice(0, 10);
    map.set(key, { date: key, count: 0 });
  }

  return map;
}

function normalizeSeries(days, docs) {
  const baseMap = buildDateRangeMap(days);
  for (const doc of docs || []) {
    if (!doc?._id || !baseMap.has(doc._id)) continue;
    baseMap.set(doc._id, {
      date: doc._id,
      count: Number(doc.count) || 0,
    });
  }
  return Array.from(baseMap.values());
}

/**
 * @param {string} fieldName
 * @param {Date} startDate
 * @param {string} collegeId
 */
async function aggregateUsersByDay(fieldName, startDate, collegeId) {
  return User1.aggregate([
    {
      $match: withCollegeEmailScope(
        { [fieldName]: { $gte: startDate } },
        collegeId,
        "email"
      ),
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: `$${fieldName}`,
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

/**
 * @param {string} fieldName
 * @param {Date} startDate
 * @param {Record<string, unknown>} match
 * @param {string} collegeId
 */
async function aggregateSubmissionsByDay(
  fieldName,
  startDate,
  match = {},
  collegeId
) {
  return Submission.aggregate([
    {
      $match: withCollegeEmailScope(
        {
          ...match,
          [fieldName]: { $gte: startDate },
        },
        collegeId,
        "submittedBy.email"
      ),
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: `$${fieldName}`,
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

function mergeSeries(days, seriesMap) {
  const baseMap = buildDateRangeMap(days);

  for (const [key, docs] of Object.entries(seriesMap || {})) {
    for (const doc of docs || []) {
      if (!doc?._id || !baseMap.has(doc._id)) continue;
      const current = baseMap.get(doc._id) || { date: doc._id };
      current[key] = Number(doc.count) || 0;
      baseMap.set(doc._id, current);
    }
  }

  return Array.from(baseMap.values()).map((entry) => ({
    ...entry,
    submissions: Number(entry.submissions) || 0,
    acceptances: Number(entry.acceptances) || 0,
  }));
}

/**
 * @param {number} [limit=5]
 * @param {string} collegeId
 */
async function aggregateTopSubmittedCompanies(limit = 5, collegeId) {
  return Submission.aggregate([
    {
      $match: withCollegeEmailScope({}, collegeId, "submittedBy.email"),
    },
    {
      $group: {
        _id: "$companyId",
        submissionCount: { $sum: 1 },
      },
    },
    { $sort: { submissionCount: -1, _id: 1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "companies",
        localField: "_id",
        foreignField: "_id",
        as: "company",
      },
    },
    {
      $project: {
        _id: 1,
        submissionCount: 1,
        name: {
          $ifNull: [{ $arrayElemAt: ["$company.name", 0] }, "Unknown company"],
        },
      },
    },
  ]);
}

async function findMostViewedApprovedCompanies(limit = 5) {
  return CompanyVisit.aggregate([
    { $match: { year: COMPANY_VISIT_YEAR, status: "approved" } },
    {
      $group: {
        _id: "$companyId",
        views: { $sum: { $ifNull: ["$views", 0] } },
        updatedAt: { $max: "$updatedAt" },
      },
    },
    { $sort: { views: -1, updatedAt: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "companies",
        localField: "_id",
        foreignField: "_id",
        as: "c",
      },
    },
    {
      $project: {
        _id: 1,
        name: { $ifNull: [{ $arrayElemAt: ["$c.name", 0] }, ""] },
        views: 1,
        updatedAt: 1,
      },
    },
  ]);
}

async function findMostHelpfulApprovedCompanies(limit = 5) {
  return CompanyVisit.aggregate([
    { $match: { year: COMPANY_VISIT_YEAR, status: "approved" } },
    { $group: { _id: "$companyId" } },
    {
      $lookup: {
        from: "companies",
        localField: "_id",
        foreignField: "_id",
        as: "c",
      },
    },
    { $unwind: { path: "$c", preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: {
          $toLower: {
            $trim: { input: { $ifNull: ["$c.name", ""] } },
          },
        },
        companyId: { $first: "$c._id" },
        name: { $first: "$c.name" },
        helpfulCount: { $max: { $ifNull: ["$c.helpfulCount", 0] } },
        updatedAt: { $max: "$c.updatedAt" },
      },
    },
    { $sort: { helpfulCount: -1, updatedAt: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: "$companyId",
        name: 1,
        helpfulCount: 1,
      },
    },
  ]);
}

/**
 * Admin dashboard snapshot. People metrics are college-scoped; company catalog is shared.
 * @param {unknown} [collegeIdRaw] — admin's college (`rvce` | `rvitm`)
 */
export async function computeAdminStatsSnapshot(collegeIdRaw = null) {
  const collegeId = normalizeCollegeId(collegeIdRaw);
  const todayStart = startOfDay(new Date());
  const sevenDayStart = addDays(todayStart, -6);
  const userMatch = withCollegeEmailScope({}, collegeId, "email");
  const submissionMatch = (extra = {}) =>
    withCollegeEmailScope(extra, collegeId, "submittedBy.email");

  const [
    totalUsers,
    totalCompanies,
    pendingSubmissions,
    dailySubmissions,
    approvedSubmissions,
    totalSubmissions,
    pendingCompanies,
    dau,
    mostViewedCompanies,
    mostHelpfulCompanies,
    topSubmittedCompanies,
    userGrowthRaw,
    dauTrend,
    submissionTrendRaw,
    acceptanceTrendRaw,
  ] = await Promise.all([
    User1.countDocuments(userMatch),
    CompanyStatic.countDocuments(),
    Submission.countDocuments(submissionMatch({ status: "pending" })),
    Submission.countDocuments(
      submissionMatch({ submittedAt: { $gte: todayStart } })
    ),
    Submission.countDocuments(submissionMatch({ status: "approved" })),
    Submission.countDocuments(submissionMatch()),
    countAdminListableCompanyVisits("pending"),
    getDauCountForDay(utcDayKey(), collegeId),
    findMostViewedApprovedCompanies(5),
    findMostHelpfulApprovedCompanies(5),
    aggregateTopSubmittedCompanies(5, collegeId),
    aggregateUsersByDay("createdAt", sevenDayStart, collegeId),
    getDauTrendSeries(7, collegeId),
    aggregateSubmissionsByDay("submittedAt", sevenDayStart, {}, collegeId),
    aggregateSubmissionsByDay(
      "approvedAt",
      sevenDayStart,
      { status: "approved" },
      collegeId
    ),
  ]);

  return {
    totalUsers,
    totalCompanies,
    pendingSubmissions,
    dailySubmissions,
    dau,
    mostViewedCompanies,
    mostHelpfulCompanies,
    topSubmittedCompanies,
    userGrowth: normalizeSeries(7, userGrowthRaw),
    dauTrend,
    submissionAcceptanceTrend: mergeSeries(7, {
      submissions: submissionTrendRaw,
      acceptances: acceptanceTrendRaw,
    }),
    totalSubmissions,
    approvedSubmissions,
    pendingCompanies,
    collegeId,
  };
}

export async function getAdminStats(req, res) {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const stats = await computeAdminStatsSnapshot(collegeId);
    return res.json(stats);
  } catch (error) {
    console.error("❌ Error fetching admin stats:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
}

export default {
  getAdminStats,
  computeAdminStatsSnapshot,
};
