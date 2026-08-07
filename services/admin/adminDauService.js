import DauDayUser from "../../models/DauDayUser.js";
import { utcDayKey } from "../dau/recordDauActivity.js";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function addUtcDays(dayKey, delta) {
  const [y, m, d] = String(dayKey)
    .split("-")
    .map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function assertDayKey(dayKey) {
  const key = String(dayKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const err = new Error("Invalid day key.");
    err.code = "INVALID_DAY";
    throw err;
  }
  return key;
}

export { utcDayKey };

/** DAU count for one day from dau_day_users. */
export async function getDauCountForDay(dayKey) {
  const key = assertDayKey(dayKey);
  return DauDayUser.countDocuments({ dayKey: key });
}

/**
 * Last N days series for admin chart: [{ date, count }, ...]
 */
export async function getDauTrendSeries(days = 7) {
  const n = Math.min(90, Math.max(1, Math.round(Number(days) || 7)));
  const today = utcDayKey(new Date());
  const keys = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    keys.push(addUtcDays(today, -i));
  }

  const grouped = await DauDayUser.aggregate([
    { $match: { dayKey: { $in: keys } } },
    { $group: { _id: "$dayKey", count: { $sum: 1 } } },
  ]);
  const byKey = new Map(grouped.map((g) => [g._id, Number(g.count) || 0]));

  return keys.map((date) => ({
    date,
    count: byKey.get(date) || 0,
  }));
}

/**
 * Lightweight last-N-day counts for the modal day chips.
 * Reads only dau_day_users (no users1 writes).
 */
export async function getDauSummaryForAdmin(days = 7) {
  const series = await getDauTrendSeries(days);
  return {
    days: series.map((d) => ({
      date: d.date,
      count: d.count,
      capturedAt: null,
      live: true,
    })),
    windowDays: series.length,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Users for one day (on day-chip click). From dau_day_users only.
 */
export async function getDauDayForAdmin(dayKey) {
  const key = assertDayKey(dayKey);
  const rows = await DauDayUser.find({ dayKey: key })
    .select("userId email username role lastSeenAt firstSeenAt")
    .sort({ lastSeenAt: -1 })
    .lean();

  const users = rows.map((u) => ({
    userId: u.userId || "",
    username: u.username || "",
    email: u.email || "",
    role: u.role || "",
    lastLoginAt: u.lastSeenAt || u.firstSeenAt || null,
  }));

  return {
    date: key,
    count: users.length,
    users,
    capturedAt: null,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Full history for Excel — all rows in dau_day_users.
 */
export async function getDauFullExportRows() {
  const rowsRaw = await DauDayUser.find({})
    .select("dayKey userId email username role lastSeenAt firstSeenAt")
    .sort({ dayKey: 1, lastSeenAt: -1 })
    .lean();

  const countByDay = new Map();
  for (const r of rowsRaw) {
    countByDay.set(r.dayKey, (countByDay.get(r.dayKey) || 0) + 1);
  }

  const rows = rowsRaw.map((u) => ({
    date: u.dayKey,
    count: countByDay.get(u.dayKey) || 0,
    username: u.username || "",
    email: u.email || "",
    role: u.role || "",
    lastLoginAt: u.lastSeenAt
      ? new Date(u.lastSeenAt).toISOString()
      : u.firstSeenAt
        ? new Date(u.firstSeenAt).toISOString()
        : "",
    userId: u.userId || "",
  }));

  return {
    rows,
    dayCount: countByDay.size,
    generatedAt: new Date().toISOString(),
  };
}
