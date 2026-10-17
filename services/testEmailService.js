import mongoose from "mongoose";
import TestEmailGrant from "../models/TestEmailGrant.js";

export const TEST_EMAIL_DURATION_HOURS = Object.freeze([2, 6, 8, 12, 24]);
export const TEST_EMAIL_LIMIT_CODE = "TEST_EMAIL_LIMIT";

const CACHE_MS = 5000;
const emailCache = new Map();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeTestEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function parseTestEmailDuration(value) {
  const hours = Number(value);
  if (!TEST_EMAIL_DURATION_HOURS.includes(hours)) return null;
  return hours;
}

export function isTestEmailGrantActive(row, now = new Date()) {
  if (!row || row.revokedAt) return false;
  const expires = new Date(row.expiresAt);
  return !Number.isNaN(expires.getTime()) && expires > now;
}

export function usageAnchorFromGrant(row) {
  const raw = row?.usageAnchorAt || row?.createdAt || row?.grantedAt;
  const date = raw ? new Date(raw) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

export function testEmailGrantStatus(row, now = new Date()) {
  if (!row) return "missing";
  if (row.revokedAt) return "revoked";
  return isTestEmailGrantActive(row, now) ? "active" : "expired";
}

export function invalidateTestEmailCache() {
  emailCache.clear();
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function serializeGrant(row, now = new Date()) {
  if (!row) return null;
  return {
    id: String(row._id || ""),
    email: normalizeTestEmail(row.email),
    durationHours: Number(row.durationHours) || null,
    expiresAt: row.expiresAt || null,
    grantedAt: row.grantedAt || null,
    usageAnchorAt: usageAnchorFromGrant(row),
    createdBy: String(row.createdBy || ""),
    revokedAt: row.revokedAt || null,
    status: testEmailGrantStatus(row, now),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}

async function readGrant(email) {
  const normalized = normalizeTestEmail(email);
  if (!normalized) return null;
  if (mongoose.connection.readyState !== 1) return null;
  const hit = emailCache.get(normalized);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.row;
  const row = await TestEmailGrant.findOne({ email: normalized }).lean();
  emailCache.set(normalized, { at: Date.now(), row: row || null });
  return row || null;
}

export async function getActiveTestEmail(email, now = new Date()) {
  const row = await readGrant(email);
  if (!isTestEmailGrantActive(row, now)) return null;
  return row;
}

export async function isActiveTestEmail(email, now = new Date()) {
  try {
    const row = await getActiveTestEmail(email, now);
    return Boolean(row);
  } catch {
    return false;
  }
}

export async function listTestEmails(now = new Date()) {
  if (mongoose.connection.readyState !== 1) return [];
  const rows = await TestEmailGrant.find({}).sort({ updatedAt: -1 }).limit(100).lean();
  return rows.map((row) => serializeGrant(row, now));
}

export async function setTestEmail({ email, durationHours, createdBy, now = new Date() } = {}) {
  const normalized = normalizeTestEmail(email);
  if (!EMAIL_RE.test(normalized)) {
    throw httpError("Enter a valid email address.", 400);
  }
  const hours = parseTestEmailDuration(durationHours);
  if (!hours) {
    throw httpError("Choose a validity of 2, 6, 8, 12, or 24 hours.", 400);
  }
  if (mongoose.connection.readyState !== 1) {
    throw httpError("Test emails cannot be saved until the database is connected.", 503);
  }
  const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const doc = await TestEmailGrant.findOneAndUpdate(
    { email: normalized },
    {
      $set: {
        email: normalized,
        durationHours: hours,
        expiresAt,
        grantedAt: now,
        createdBy: normalizeTestEmail(createdBy),
        revokedAt: null,
      },
      $setOnInsert: {
        usageAnchorAt: now,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  invalidateTestEmailCache();
  return serializeGrant(doc, now);
}

export async function revokeTestEmail(email, now = new Date()) {
  const normalized = normalizeTestEmail(email);
  if (!normalized) throw httpError("Email is required.", 400);
  if (mongoose.connection.readyState !== 1) {
    throw httpError("Test emails cannot be updated until the database is connected.", 503);
  }
  const doc = await TestEmailGrant.findOneAndUpdate(
    { email: normalized },
    { $set: { revokedAt: now } },
    { new: true }
  ).lean();
  if (!doc) throw httpError("Test email was not found.", 404);
  invalidateTestEmailCache();
  return serializeGrant(doc, now);
}
