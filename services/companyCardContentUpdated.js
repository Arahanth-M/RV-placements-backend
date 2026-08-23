/**
 * Redis stamps for company-card “last updated” (content only, not profile views).
 * Does not write company / visit / submission Mongo documents.
 */
import redis from "../utils/redis.js";
import { getJSON, setJSON } from "../src/utils/redisHelpers.js";
import { laterDateIso } from "../utils/laterDate.js";

function idString(value) {
  if (value == null || value === "") return "";
  return String(value);
}

export function companyContentUpdatedKey(companyId) {
  const id = idString(companyId);
  return id ? `card:content-updated:c:${id}` : "";
}

export function visitContentUpdatedKey(visitId) {
  const id = idString(visitId);
  return id ? `card:content-updated:v:${id}` : "";
}

async function stampIfLater(key, iso) {
  if (!key || !iso) return;
  try {
    const existing = await getJSON(key);
    const next = laterDateIso(existing?.at, iso);
    if (!next) return;
    if (existing?.at && next === existing.at) return;
    await setJSON(key, { at: next });
  } catch {
    // Optional stamp
  }
}

/**
 * Record that About / Roles / Stats / OA / interview / must-do / recruitment /
 * internship / coding / trending / helpful changed for this company or visit.
 */
export async function touchCardContentUpdated({
  companyId = null,
  visitId = null,
  at = new Date(),
} = {}) {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return false;
  const iso = d.toISOString();
  await Promise.all([
    stampIfLater(companyContentUpdatedKey(companyId), iso),
    stampIfLater(visitContentUpdatedKey(visitId), iso),
  ]);
  return true;
}

function parseStamp(raw) {
  if (raw == null || raw === "") return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed?.at || null;
  } catch {
    return null;
  }
}

/**
 * Overlay Redis content stamps onto list rows (after Mongo-derived contentUpdatedAt).
 * @param {Record<string, unknown>[]} list
 */
export async function attachCardContentUpdatedAt(list) {
  const rows = Array.isArray(list) ? list : [];
  const companyIds = [...new Set(rows.map((row) => idString(row?._id)).filter(Boolean))];
  const visitIds = [
    ...new Set(rows.map((row) => idString(row?.placementCompanyVisitId)).filter(Boolean)),
  ];
  const companyKeys = companyIds.map(companyContentUpdatedKey);
  const visitKeys = visitIds.map(visitContentUpdatedKey);

  /** @type {(string|null)[]} */
  let companyRaws = [];
  /** @type {(string|null)[]} */
  let visitRaws = [];
  try {
    if (companyKeys.length) companyRaws = await redis.mGet(companyKeys);
    if (visitKeys.length) visitRaws = await redis.mGet(visitKeys);
  } catch {
    companyRaws = companyKeys.map(() => null);
    visitRaws = visitKeys.map(() => null);
  }

  const companyAt = new Map();
  companyIds.forEach((id, i) => {
    const at = parseStamp(companyRaws[i]);
    if (at) companyAt.set(id, at);
  });
  const visitAt = new Map();
  visitIds.forEach((id, i) => {
    const at = parseStamp(visitRaws[i]);
    if (at) visitAt.set(id, at);
  });

  return rows.map((row) => {
    const cid = idString(row?._id);
    const vid = idString(row?.placementCompanyVisitId);
    const next = laterDateIso(
      row?.contentUpdatedAt,
      cid ? companyAt.get(cid) : null,
      vid ? visitAt.get(vid) : null
    );
    return next ? { ...row, contentUpdatedAt: next } : row;
  });
}
