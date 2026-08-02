import InterviewSession from "../models/InterviewSession.js";
import PrepPathPlan from "../models/PrepPathPlan.js";

const IST_TZ = "Asia/Kolkata";
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const TOP_COMPANIES = 50;

function clampDays(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, Math.floor(n)));
}

function startOfIstDayUtc(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  // IST midnight as UTC instant
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function istDateKeyFromUtc(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildEmptyDaySeries(days, rangeStartUtc) {
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const day = addDays(rangeStartUtc, i);
    out.push({ date: istDateKeyFromUtc(day), count: 0 });
  }
  return out;
}

function fillDaySeries(days, rangeStartUtc, docs) {
  const series = buildEmptyDaySeries(days, rangeStartUtc);
  const index = new Map(series.map((row, i) => [row.date, i]));
  for (const doc of docs || []) {
    const key = String(doc?._id || "").trim();
    if (!index.has(key)) continue;
    series[index.get(key)].count = Number(doc.count) || 0;
  }
  return series;
}

async function aggregateByIstDay(Model, rangeStartUtc) {
  return Model.aggregate([
    { $match: { createdAt: { $gte: rangeStartUtc } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
            timezone: IST_TZ,
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

async function aggregatePrepPathsByCompany(rangeStartUtc, limit = TOP_COMPANIES) {
  return PrepPathPlan.aggregate([
    { $match: { createdAt: { $gte: rangeStartUtc } } },
    {
      $group: {
        _id: "$companyId",
        count: { $sum: 1 },
        companyName: { $first: "$companyName" },
      },
    },
    { $sort: { count: -1, companyName: 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        companyId: { $toString: "$_id" },
        companyName: {
          $cond: [
            {
              $and: [
                { $ne: ["$companyName", null] },
                { $ne: ["$companyName", ""] },
              ],
            },
            "$companyName",
            "Unknown company",
          ],
        },
        count: 1,
      },
    },
  ]);
}

/**
 * Admin usage analytics: AI mock interviews + PrepPath generations (IST days).
 * @param {{ days?: unknown }} [options]
 */
export async function getAdminUsageAnalytics(options = {}) {
  const days = clampDays(options.days);
  const todayStart = startOfIstDayUtc(new Date());
  const rangeStartUtc = addDays(todayStart, -(days - 1));

  const [
    interviewTotal,
    interviewByDayRaw,
    prepPathTotal,
    prepPathByDayRaw,
    prepPathByCompany,
    prepPathTotalInRange,
    interviewTotalInRange,
  ] = await Promise.all([
    InterviewSession.countDocuments({}),
    aggregateByIstDay(InterviewSession, rangeStartUtc),
    PrepPathPlan.countDocuments({}),
    aggregateByIstDay(PrepPathPlan, rangeStartUtc),
    aggregatePrepPathsByCompany(rangeStartUtc),
    PrepPathPlan.countDocuments({ createdAt: { $gte: rangeStartUtc } }),
    InterviewSession.countDocuments({ createdAt: { $gte: rangeStartUtc } }),
  ]);

  return {
    timezone: IST_TZ,
    rangeDays: days,
    rangeStart: istDateKeyFromUtc(rangeStartUtc),
    rangeEnd: istDateKeyFromUtc(todayStart),
    interviews: {
      total: interviewTotal,
      totalInRange: interviewTotalInRange,
      byDay: fillDaySeries(days, rangeStartUtc, interviewByDayRaw),
    },
    prepPaths: {
      total: prepPathTotal,
      totalInRange: prepPathTotalInRange,
      byDay: fillDaySeries(days, rangeStartUtc, prepPathByDayRaw),
      byCompany: prepPathByCompany,
    },
  };
}
