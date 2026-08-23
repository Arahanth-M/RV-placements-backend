import Submission from "../models/Submission.js";
import CompanyVisit from "../models/CompanyVisit.js";
import { normalizeSubmitterEmail } from "./mySubmissionsCache.js";

/** Approved student submissions included in the login digest. */
export const DIGEST_SUBMISSION_TYPES = [
  "onlineQuestions",
  "interviewQuestions",
  "interviewProcess",
  "mustDoTopics",
];

/** @deprecated Use DIGEST_SUBMISSION_TYPES; kept for existing imports. */
export const DIGEST_TYPES = DIGEST_SUBMISSION_TYPES;

export const DIGEST_TYPE_LABELS = {
  onlineQuestions: { singular: "OA question", plural: "OA questions" },
  interviewQuestions: {
    singular: "interview question",
    plural: "interview questions",
  },
  interviewProcess: {
    singular: "interview experience",
    plural: "interview experiences",
  },
  mustDoTopics: { singular: "must-do topic", plural: "must-do topics" },
  recruitmentProcess: {
    singular: "recruitment process",
    plural: "recruitment processes",
  },
};

export const DIGEST_SUMMARY_ORDER = [
  "onlineQuestions",
  "interviewQuestions",
  "interviewProcess",
  "mustDoTopics",
  "recruitmentProcess",
];

export const DIGEST_MAX_COMPANIES = 10;
export const DIGEST_MAX_SCAN = 250;
export const DIGEST_MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

function parseDigestDate(value) {
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Cap a cursor so a long absence does not dump the entire catalog.
 * @param {unknown} cursor
 * @param {Date} [now]
 * @returns {Date|null}
 */
export function resolveDigestSince(cursor, now = new Date()) {
  const parsed = parseDigestDate(cursor);
  if (!parsed) return null;
  const current = parsed > now ? now : parsed;
  const floor = new Date(now.getTime() - DIGEST_MAX_LOOKBACK_MS);
  return current > floor ? current : floor;
}

/**
 * Prefer the later of client last-seen and JWT previous login so already-seen
 * items are not shown again. No Mongo writes.
 * @param {{ clientSince?: unknown, previousLastLoginAt?: unknown }} params
 * @param {Date} [now]
 * @returns {Date|null}
 */
export function pickDigestCursor(
  { clientSince, previousLastLoginAt } = {},
  now = new Date()
) {
  const client = parseDigestDate(clientSince);
  const jwt = parseDigestDate(previousLastLoginAt);
  let chosen = null;
  if (client && jwt) {
    chosen = client > jwt ? client : jwt;
  } else {
    chosen = client || jwt;
  }
  return resolveDigestSince(chosen, now);
}

function countPhrase(count, singular, plural) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * @param {Record<string, number>} counts
 * @returns {string}
 */
export function formatDigestSummary(counts) {
  const parts = DIGEST_SUMMARY_ORDER.map((type) => {
    const labels = DIGEST_TYPE_LABELS[type];
    return countPhrase(counts?.[type], labels.singular, labels.plural);
  }).filter(Boolean);
  return parts.join(", ");
}

export function emptyDigestCounts() {
  return {
    onlineQuestions: 0,
    interviewQuestions: 0,
    interviewProcess: 0,
    mustDoTopics: 0,
    recruitmentProcess: 0,
  };
}

/**
 * Popup gate: show only when there is enough new material.
 * - ≥1 interview experience, or
 * - ≥1 recruitment process, or
 * - ≥2 OA questions + interview questions + must-do topics (combined, any companies)
 */
export function digestMeetsShowThreshold(companies) {
  const list = Array.isArray(companies) ? companies : [];
  let interviewProcess = 0;
  let recruitmentProcess = 0;
  let questionLike = 0;
  for (const row of list) {
    interviewProcess += Number(row?.interviewProcess) || 0;
    recruitmentProcess += Number(row?.recruitmentProcess) || 0;
    questionLike +=
      (Number(row?.onlineQuestions) || 0) +
      (Number(row?.interviewQuestions) || 0) +
      (Number(row?.mustDoTopics) || 0);
  }
  return interviewProcess >= 1 || recruitmentProcess >= 1 || questionLike >= 2;
}

function digestYearFromRow(row) {
  const placed = Number(row?.placementYear);
  if (Number.isInteger(placed) && placed >= 2000 && placed <= 2100) {
    return placed;
  }
  const approved = row?.approvedAt ? new Date(row.approvedAt) : null;
  if (approved && !Number.isNaN(approved.getTime())) {
    return approved.getFullYear();
  }
  return null;
}

function digestYearFromVisit(visit) {
  const year = Number(visit?.year);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) return year;
  return null;
}

function addDigestHit(grouped, { companyId, companyName, year, type }) {
  if (!companyId || !DIGEST_TYPE_LABELS[type]) return;
  const groupKey = `${companyId}:${year || "unknown"}`;
  let entry = grouped.get(groupKey);
  if (!entry) {
    entry = {
      companyId,
      companyName: String(companyName || "").trim() || "Unknown company",
      year,
      counts: emptyDigestCounts(),
    };
    grouped.set(groupKey, entry);
  }
  entry.counts[type] += 1;
}

/**
 * Read-only: approved OA / interview Qs / experiences / must-do, plus
 * recruitment process saved after last login. Does not write to MongoDB.
 * @param {{ since?: unknown, previousLastLoginAt?: unknown, viewerEmail?: unknown }} params
 */
export async function getLoginContentDigest({
  since: clientSince,
  previousLastLoginAt,
  viewerEmail,
} = {}) {
  const since = pickDigestCursor({ clientSince, previousLastLoginAt });
  if (!since) {
    return { companies: [], since: null, truncated: false };
  }

  const sinceIso = since.toISOString();
  const viewer = normalizeSubmitterEmail(viewerEmail);

  const [rows, visits] = await Promise.all([
    Submission.find({
      status: "approved",
      type: { $in: DIGEST_SUBMISSION_TYPES },
      approvedAt: { $gt: since },
    })
      .select("companyId type approvedAt submittedBy.email placementYear")
      .sort({ approvedAt: -1, _id: -1 })
      .limit(DIGEST_MAX_SCAN)
      .populate("companyId", "name")
      .lean(),
    CompanyVisit.find({
      $or: [
        { "recruitment_process.submittedAt": { $gt: since } },
        { "recruitment_process.submittedAt": { $gt: sinceIso } },
      ],
    })
      .select("companyId year recruitment_process.submittedAt recruitment_process.submittedBy")
      .sort({ "recruitment_process.submittedAt": -1, _id: -1 })
      .limit(DIGEST_MAX_SCAN)
      .populate("companyId", "name")
      .lean(),
  ]);

  const grouped = new Map();

  for (const row of rows) {
    if (
      viewer &&
      normalizeSubmitterEmail(row?.submittedBy?.email) === viewer
    ) {
      continue;
    }
    const companyDoc = row?.companyId;
    const companyId = companyDoc?._id != null ? String(companyDoc._id) : "";
    addDigestHit(grouped, {
      companyId,
      companyName: companyDoc?.name,
      year: digestYearFromRow(row),
      type: String(row?.type || ""),
    });
  }

  for (const visit of visits) {
    const submittedAt = parseDigestDate(visit?.recruitment_process?.submittedAt);
    if (!submittedAt || submittedAt <= since) continue;
    if (
      viewer &&
      normalizeSubmitterEmail(visit?.recruitment_process?.submittedBy?.email) ===
        viewer
    ) {
      continue;
    }
    const companyDoc = visit?.companyId;
    const companyId = companyDoc?._id != null ? String(companyDoc._id) : "";
    addDigestHit(grouped, {
      companyId,
      companyName: companyDoc?.name,
      year: digestYearFromVisit(visit),
      type: "recruitmentProcess",
    });
  }

  const allCompanies = [...grouped.values()].map((entry) => ({
    companyId: entry.companyId,
    companyName: entry.companyName,
    year: entry.year,
    ...entry.counts,
    summary: formatDigestSummary(entry.counts),
  }));

  const truncated =
    rows.length >= DIGEST_MAX_SCAN ||
    visits.length >= DIGEST_MAX_SCAN ||
    allCompanies.length > DIGEST_MAX_COMPANIES;

  const companies = digestMeetsShowThreshold(allCompanies)
    ? allCompanies.slice(0, DIGEST_MAX_COMPANIES)
    : [];

  return {
    companies,
    since: since.toISOString(),
    truncated: companies.length > 0 && truncated,
  };
}
