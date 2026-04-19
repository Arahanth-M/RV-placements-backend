import User from "../models/User.js";
import Submission from "../models/Submission.js";
import Company from "../models/Company.js";
import MissingCompany from "../models/MissingCompany.js";

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

async function aggregateUsersByDay(fieldName, startDate) {
  return User.aggregate([
    {
      $match: {
        [fieldName]: { $gte: startDate },
      },
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

async function aggregateSubmissionsByDay(fieldName, startDate, match = {}) {
  return Submission.aggregate([
    {
      $match: {
        ...match,
        [fieldName]: { $gte: startDate },
      },
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

async function aggregateTopSubmittedCompanies(limit = 5) {
  return Submission.aggregate([
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
        from: "companies1",
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

export async function computeAdminStatsSnapshot() {
  const todayStart = startOfDay(new Date());
  const sevenDayStart = addDays(todayStart, -6);

  const [
    totalUsers,
    totalCompanies,
    pendingSubmissions,
    dailySubmissions,
    approvedSubmissions,
    totalSubmissions,
    pendingCompanies,
    missingCompaniesCount,
    dau,
    topMissingCompanies,
    mostViewedCompanies,
    mostHelpfulCompanies,
    topSubmittedCompanies,
    userGrowthRaw,
    dauTrendRaw,
    submissionTrendRaw,
    acceptanceTrendRaw,
  ] = await Promise.all([
    User.countDocuments(),
    Company.countDocuments(),
    Submission.countDocuments({ status: "pending" }),
    Submission.countDocuments({ submittedAt: { $gte: todayStart } }),
    Submission.countDocuments({ status: "approved" }),
    Submission.countDocuments(),
    Company.countDocuments({ status: "pending" }),
    MissingCompany.countDocuments(),
    User.countDocuments({ lastActiveAt: { $gte: todayStart } }),
    MissingCompany.find({})
      .select("name requestCount status")
      .sort({ requestCount: -1, createdAt: -1 })
      .limit(5)
      .lean(),
    Company.find({ status: "approved" })
      .select("name views")
      .sort({ views: -1, updatedAt: -1 })
      .limit(5)
      .lean(),
    Company.find({ status: "approved" })
      .select("name helpfulCount")
      .sort({ helpfulCount: -1, updatedAt: -1 })
      .limit(5)
      .lean(),
    aggregateTopSubmittedCompanies(5),
    aggregateUsersByDay("createdAt", sevenDayStart),
    aggregateUsersByDay("lastActiveAt", sevenDayStart),
    aggregateSubmissionsByDay("submittedAt", sevenDayStart),
    aggregateSubmissionsByDay("approvedAt", sevenDayStart, { status: "approved" }),
  ]);

  return {
    totalUsers,
    totalCompanies,
    pendingSubmissions,
    dailySubmissions,
    missingCompaniesCount,
    dau,
    topMissingCompanies,
    mostViewedCompanies,
    mostHelpfulCompanies,
    topSubmittedCompanies,
    userGrowth: normalizeSeries(7, userGrowthRaw),
    dauTrend: normalizeSeries(7, dauTrendRaw),
    submissionAcceptanceTrend: mergeSeries(7, {
      submissions: submissionTrendRaw,
      acceptances: acceptanceTrendRaw,
    }),
    totalSubmissions,
    approvedSubmissions,
    pendingCompanies,
  };
}

export async function getAdminStats(req, res) {
  try {
    const stats = await computeAdminStatsSnapshot();
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
