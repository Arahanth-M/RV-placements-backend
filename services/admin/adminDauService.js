import DauDayUser from "../../models/DauDayUser.js";
import { utcDayKey } from "../dau/recordDauActivity.js";
import { formatDauActionLabels } from "../dau/dauActions.js";
import {
  combineActiveMs,
  formatActiveMsLabel,
  getPendingActiveMsMap,
} from "../dau/dauActiveTime.js";
import {
  normalizeCollegeId,
  withCollegeEmailScope,
} from "../../utils/collegeScope.js";

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

/**
 * @param {unknown} collegeIdRaw
 * @returns {string}
 */
function resolveCollegeId(collegeIdRaw) {
  return normalizeCollegeId(collegeIdRaw);
}

/** DAU count for one day from dau_day_users (optionally college-scoped). */
export async function getDauCountForDay(dayKey, collegeIdRaw = null) {
  const key = assertDayKey(dayKey);
  const collegeId = resolveCollegeId(collegeIdRaw);
  const match = withCollegeEmailScope({ dayKey: key }, collegeId, "email");
  return DauDayUser.countDocuments(match);
}

/**
 * Last N days series for admin chart: [{ date, count }, ...]
 * @param {number} [days=7]
 * @param {unknown} [collegeIdRaw]
 */
export async function getDauTrendSeries(days = 7, collegeIdRaw = null) {
  const n = Math.min(90, Math.max(1, Math.round(Number(days) || 7)));
  const today = utcDayKey(new Date());
  const keys = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    keys.push(addUtcDays(today, -i));
  }

  const collegeId = resolveCollegeId(collegeIdRaw);
  const match = withCollegeEmailScope(
    { dayKey: { $in: keys } },
    collegeId,
    "email"
  );

  const grouped = await DauDayUser.aggregate([
    { $match: match },
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
 * @param {number} [days=7]
 * @param {unknown} [collegeIdRaw]
 */
export async function getDauSummaryForAdmin(days = 7, collegeIdRaw = null) {
  const series = await getDauTrendSeries(days, collegeIdRaw);
  return {
    days: series.map((d) => ({
      date: d.date,
      count: d.count,
      capturedAt: null,
      live: true,
    })),
    windowDays: series.length,
    collegeId: resolveCollegeId(collegeIdRaw),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Users for one day (on day-chip click). From dau_day_users only.
 * @param {unknown} dayKey
 * @param {unknown} [collegeIdRaw]
 */
export async function getDauDayForAdmin(dayKey, collegeIdRaw = null) {
  const key = assertDayKey(dayKey);
  const collegeId = resolveCollegeId(collegeIdRaw);
  const match = withCollegeEmailScope({ dayKey: key }, collegeId, "email");
  const rows = await DauDayUser.find(match)
    .select("userId email username role lastSeenAt firstSeenAt activeMs")
    .sort({ lastSeenAt: -1 })
    .lean();

  const today = utcDayKey();
  const pendingByUser =
    key === today
      ? await getPendingActiveMsMap(
          key,
          rows.map((u) => u.userId)
        )
      : new Map();

  const users = rows.map((u) => {
    const activeMs = combineActiveMs(u.activeMs, pendingByUser.get(String(u.userId || "")));
    return {
      userId: u.userId || "",
      username: u.username || "",
      email: u.email || "",
      role: u.role || "",
      lastLoginAt: u.lastSeenAt || u.firstSeenAt || null,
      activeMs,
      activeLabel: formatActiveMsLabel(activeMs),
    };
  });

  return {
    date: key,
    count: users.length,
    users,
    collegeId,
    capturedAt: null,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Activity chips for one DAU row. Fetched only when admin expands that user.
 * @param {unknown} dayKey
 * @param {unknown} userIdRaw
 * @param {unknown} [collegeIdRaw]
 */
export async function getDauDayUserActivityForAdmin(
  dayKey,
  userIdRaw,
  collegeIdRaw = null
) {
  const key = assertDayKey(dayKey);
  const userId = String(userIdRaw || "").trim();
  if (!userId) {
    const err = new Error("Invalid user.");
    err.code = "INVALID_USER";
    throw err;
  }
  const collegeId = resolveCollegeId(collegeIdRaw);
  const match = withCollegeEmailScope({ dayKey: key, userId }, collegeId, "email");
  const row = await DauDayUser.findOne(match)
    .select("actions openedCompanies prepPathCompanies")
    .lean();
  if (!row) {
    const err = new Error("User not found for that day.");
    err.code = "NOT_FOUND";
    throw err;
  }
  return {
    date: key,
    userId,
    actions: formatDauActionLabels(
      row.actions,
      row.openedCompanies,
      row.prepPathCompanies
    ),
  };
}

/**
 * Full history for Excel — dau_day_users scoped to admin college.
 * @param {unknown} [collegeIdRaw]
 */
export async function getDauFullExportRows(collegeIdRaw = null) {
  const collegeId = resolveCollegeId(collegeIdRaw);
  const match = withCollegeEmailScope({}, collegeId, "email");
  const rowsRaw = await DauDayUser.find(match)
    .select("dayKey userId email username role lastSeenAt firstSeenAt actions openedCompanies prepPathCompanies activeMs")
    .sort({ dayKey: 1, lastSeenAt: -1 })
    .lean();

  const countByDay = new Map();
  for (const r of rowsRaw) {
    countByDay.set(r.dayKey, (countByDay.get(r.dayKey) || 0) + 1);
  }

  const today = utcDayKey();
  const todayIds = rowsRaw.filter((r) => r.dayKey === today).map((r) => r.userId);
  const pendingByUser = await getPendingActiveMsMap(today, todayIds);

  const rows = rowsRaw.map((u) => {
    const pending = u.dayKey === today ? pendingByUser.get(String(u.userId || "")) : 0;
    const activeMs = combineActiveMs(u.activeMs, pending);
    return {
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
      actions: formatDauActionLabels(u.actions, u.openedCompanies, u.prepPathCompanies),
      activity: formatDauActionLabels(u.actions, u.openedCompanies, u.prepPathCompanies).join(", "),
      activeMs,
      activeLabel: formatActiveMsLabel(activeMs),
    };
  });

  return {
    rows,
    dayCount: countByDay.size,
    collegeId,
    generatedAt: new Date().toISOString(),
  };
}
