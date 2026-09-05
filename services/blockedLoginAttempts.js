import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { config } from "../config/constants.js";
import BlockedLoginAttempt from "../models/BlockedLoginAttempt.js";
import { isAllowedCollegeEmail } from "../utils/collegeScope.js";

export const BLOCKED_LOGIN_INTENT_TYP = "blocked_login_intent";
export const BLOCKED_LOGIN_INTENT_EXPIRES = "15m";
export const BLOCKED_LOGIN_COLLEGE_NAME_MAX = 120;

const DEFAULT_SUMMARY_DAYS = 30;
const MAX_SUMMARY_DAYS = 90;
const RECENT_LIMIT = 50;
const TOP_LIMIT = 10;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function utcDayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addUtcDays(dayKey, delta) {
  const [y, m, d] = String(dayKey)
    .split("-")
    .map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * @param {unknown} email
 * @returns {string}
 */
export function emailDomainFromEmail(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return "";
  return e.slice(at + 1);
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeCollegeName(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, BLOCKED_LOGIN_COLLEGE_NAME_MAX);
}

/**
 * @param {unknown} raw
 * @returns {"login"|"signup"|"admin"}
 */
export function normalizeBlockedLoginFlow(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "signup" || s === "admin") return s;
  return "login";
}

/**
 * @param {unknown} attemptId
 * @returns {string}
 */
export function signBlockedLoginIntentToken(attemptId) {
  const id = String(attemptId || "").trim();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid blocked-login attempt id");
  }
  if (!config.JWT_SECRET) {
    throw new Error("JWT_SECRET is not set");
  }
  return jwt.sign(
    { typ: BLOCKED_LOGIN_INTENT_TYP, attemptId: id },
    config.JWT_SECRET,
    { expiresIn: BLOCKED_LOGIN_INTENT_EXPIRES }
  );
}

/**
 * @param {unknown} token
 * @returns {string} attemptId
 */
export function verifyBlockedLoginIntentToken(token) {
  const raw = String(token || "").trim();
  if (!raw || !config.JWT_SECRET) {
    const err = new Error("Invalid or expired interest token");
    err.code = "INVALID_TOKEN";
    throw err;
  }
  let payload;
  try {
    payload = jwt.verify(raw, config.JWT_SECRET);
  } catch {
    const err = new Error("Invalid or expired interest token");
    err.code = "INVALID_TOKEN";
    throw err;
  }
  if (!payload || payload.typ !== BLOCKED_LOGIN_INTENT_TYP) {
    const err = new Error("Invalid or expired interest token");
    err.code = "INVALID_TOKEN";
    throw err;
  }
  const attemptId = String(payload.attemptId || "").trim();
  if (!attemptId || !mongoose.Types.ObjectId.isValid(attemptId)) {
    const err = new Error("Invalid or expired interest token");
    err.code = "INVALID_TOKEN";
    throw err;
  }
  return attemptId;
}

/**
 * Insert a blocked-login row. Never writes users1 or DAU.
 * Allowed college emails are ignored (returns "").
 * @param {{ email?: unknown, googleId?: unknown, displayName?: unknown, flow?: unknown, reason?: unknown }} input
 * @returns {Promise<string>} attempt id or ""
 */
export async function recordBlockedLoginAttempt(input = {}) {
  const email = String(input.email || "")
    .trim()
    .toLowerCase();
  if (!email || isAllowedCollegeEmail(email)) return "";

  const doc = await BlockedLoginAttempt.create({
    email,
    emailDomain: emailDomainFromEmail(email),
    googleId: String(input.googleId || "").trim(),
    displayName: String(input.displayName || "").trim(),
    reason: String(input.reason || "domain").trim() || "domain",
    flow: normalizeBlockedLoginFlow(input.flow),
  });
  return String(doc._id);
}

/**
 * Attach college interest to the attempt identified by the short-lived token.
 * Submitting a college name means they want the platform there.
 * @param {{ token?: unknown, collegeName?: unknown }} input
 */
export async function submitBlockedLoginInterest(input = {}) {
  const attemptId = verifyBlockedLoginIntentToken(input.token);
  const collegeName = normalizeCollegeName(input.collegeName);
  if (collegeName.length < 2) {
    const err = new Error("College name is required");
    err.code = "INVALID_COLLEGE";
    throw err;
  }

  const updated = await BlockedLoginAttempt.findByIdAndUpdate(
    attemptId,
    {
      $set: {
        collegeName,
        wantsPlatformAtCollege: true,
        respondedAt: new Date(),
      },
    },
    { new: true }
  ).lean();

  if (!updated) {
    const err = new Error("This sign-in attempt is no longer available");
    err.code = "NOT_FOUND";
    throw err;
  }

  return {
    ok: true,
    collegeName: updated.collegeName || collegeName,
    wantsPlatformAtCollege: updated.wantsPlatformAtCollege === true,
  };
}

function clampDays(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SUMMARY_DAYS;
  return Math.min(MAX_SUMMARY_DAYS, Math.max(1, Math.floor(n)));
}

/**
 * Admin-only aggregates. Reads blocked_login_attempts only.
 * @param {unknown} [daysRaw]
 */
export async function getBlockedLoginSummaryForAdmin(daysRaw) {
  const days = clampDays(daysRaw);
  const today = utcDayKey(new Date());
  const fromKey = addUtcDays(today, -(days - 1));
  const fromDate = new Date(`${fromKey}T00:00:00.000Z`);
  const match = { createdAt: { $gte: fromDate } };

  const [
    attemptCount,
    uniqueEmails,
    respondedCount,
    wantsPlatformCount,
    topCollegesRaw,
    topDomainsRaw,
    trendRaw,
    recentRaw,
  ] = await Promise.all([
    BlockedLoginAttempt.countDocuments(match),
    BlockedLoginAttempt.distinct("email", match),
    BlockedLoginAttempt.countDocuments({
      ...match,
      respondedAt: { $exists: true, $ne: null },
    }),
    BlockedLoginAttempt.countDocuments({
      ...match,
      wantsPlatformAtCollege: true,
    }),
    BlockedLoginAttempt.aggregate([
      { $match: { ...match, collegeName: { $nin: [null, ""] } } },
      { $group: { _id: "$collegeName", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: TOP_LIMIT },
    ]),
    BlockedLoginAttempt.aggregate([
      { $match: { ...match, emailDomain: { $nin: [null, ""] } } },
      { $group: { _id: "$emailDomain", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: TOP_LIMIT },
    ]),
    BlockedLoginAttempt.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    BlockedLoginAttempt.find(match)
      .select(
        "email emailDomain displayName collegeName wantsPlatformAtCollege createdAt respondedAt flow"
      )
      .sort({ createdAt: -1 })
      .limit(RECENT_LIMIT)
      .lean(),
  ]);

  const keys = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    keys.push(addUtcDays(today, -i));
  }
  const byKey = new Map((trendRaw || []).map((g) => [g._id, Number(g.count) || 0]));

  return {
    windowDays: days,
    attemptCount,
    uniqueEmails: Array.isArray(uniqueEmails) ? uniqueEmails.length : 0,
    respondedCount,
    wantsPlatformCount,
    topColleges: (topCollegesRaw || []).map((row) => ({
      collegeName: String(row._id || ""),
      count: Number(row.count) || 0,
    })),
    topDomains: (topDomainsRaw || []).map((row) => ({
      domain: String(row._id || ""),
      count: Number(row.count) || 0,
    })),
    trend: keys.map((date) => ({ date, count: byKey.get(date) || 0 })),
    recent: (recentRaw || []).map((row) => ({
      id: String(row._id),
      email: row.email || "",
      emailDomain: row.emailDomain || "",
      displayName: row.displayName || "",
      collegeName: row.collegeName || "",
      wantsPlatformAtCollege:
        typeof row.wantsPlatformAtCollege === "boolean"
          ? row.wantsPlatformAtCollege
          : null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      respondedAt: row.respondedAt ? new Date(row.respondedAt).toISOString() : null,
      flow: row.flow || "login",
    })),
    generatedAt: new Date().toISOString(),
  };
}
