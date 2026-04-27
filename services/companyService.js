/**
 * Merges `companies` + `company_visits` into the legacy companies1 API shape
 * (field names the frontend / old routes expect). No new keys like must_do_topics
 * in the outgoing payload — those are mapped to Must_Do_Topics, etc.
 */
import mongoose from "mongoose";
import CompanyStatic from "../models/CompanyStatic.js";
import CompanyVisit from "../models/CompanyVisit.js";
import { attachPlacementCategoryToCompany } from "../utils/ctcCategory.js";
import {
  buildCategoryPreviewResponse,
  sortCompaniesForCategoryPreview,
} from "../utils/companyCategoryPreviewBuckets.js";
import { invalidateCompanyDetailCache } from "./companyDetailCache.js";

export const COMPANY_VISIT_YEAR = 2026;

/** Placement years exposed on company detail (?year=) and year-scoped merge. */
export const COMPANY_DETAIL_VISIT_YEARS = Object.freeze([2026, 2027]);

/**
 * @param {unknown} raw
 * @returns {number}
 */
export function normalizeCompanyDetailYear(raw) {
  if (raw == null || raw === "") return COMPANY_VISIT_YEAR;
  const n = Number(raw);
  if (!Number.isFinite(n) || !COMPANY_DETAIL_VISIT_YEARS.includes(n)) {
    return COMPANY_VISIT_YEAR;
  }
  return n;
}

/** Dropped from API responses; internal split-schema bookkeeping only. */
const INTERNAL_STRIP = ["sourceCopyId", "nameKey", "migratedAt"];

/**
 * @param {Record<string, unknown>} doc
 * @param {string[]} [extra]
 */
function stripInternalFields(doc, extra = []) {
  if (!doc || typeof doc !== "object") return doc;
  const o = { ...doc };
  for (const k of [...INTERNAL_STRIP, ...extra]) {
    if (k in o) delete o[k];
  }
  return o;
}

/**
 * @param {unknown} m
 * @returns {import("mongoose").Types.ObjectId|null}
 */
function toObjectId(m) {
  if (m == null) return null;
  if (m instanceof mongoose.Types.ObjectId) return m;
  try {
    return new mongoose.Types.ObjectId(String(m));
  } catch {
    return null;
  }
}

/**
 * Same as legacy GET /:id — roles[].ctc Map → plain object for JSON.
 * @param {Record<string, unknown>} legacy
 */
function flattenRoleCtcForJson(legacy) {
  const roles = legacy.roles;
  if (!Array.isArray(roles)) return;
  legacy.roles = roles.map((role) => {
    if (!role || typeof role !== "object") return role;
    const r = { ...role };
    if (r.ctc instanceof Map) {
      r.ctc = Object.fromEntries(r.ctc);
    }
    return r;
  });
}

/**
 * @param {Record<string, unknown>} staticDoc
 * @param {Record<string, unknown>|null|undefined} visitDoc
 * @returns {Record<string, unknown>}
 */
export function mergeToLegacyShape(staticDoc, visitDoc) {
  const s = staticDoc && typeof staticDoc === "object" ? { ...staticDoc } : {};
  const aboutVal = s.about;
  const must = s.must_do_topics;

  /** @type {Record<string, unknown>} */
  const out = {
    ...stripInternalFields(s, ["about", "must_do_topics"]),
  };

  if (aboutVal !== undefined) {
    out["About The Company"] = aboutVal;
  }
  if (must !== undefined) {
    out.Must_Do_Topics = must;
  }

  if (visitDoc && typeof visitDoc === "object") {
    const skip = new Set(["_id", "companyId", "year", "migratedAt", "sourceCopyId"]);
    for (const [key, val] of Object.entries(visitDoc)) {
      if (skip.has(key)) continue;
      if (val !== undefined) {
        out[key] = val;
      }
    }
  }

  flattenRoleCtcForJson(out);
  return out;
}

/**
 * Latest visit for year (any status) — e.g. to detect pending vs no row.
 * @param {import("mongoose").Types.ObjectId} companyId
 */
export async function findAnyLatestVisitForCompanyYear(
  companyId,
  year = COMPANY_VISIT_YEAR
) {
  const one = await CompanyVisit.find({ companyId, year })
    .sort({ migratedAt: -1, _id: -1 })
    .limit(1)
    .lean();
  return one[0] ?? null;
}

/**
 * Latest approved visit for the year (used for public detail + list merge).
 * @param {import("mongoose").Types.ObjectId} companyId
 * @param {number} [year]
 */
export async function findLatestVisitForCompany(companyId, year = COMPANY_VISIT_YEAR) {
  const one = await CompanyVisit.find({
    companyId,
    year,
    status: "approved",
  })
    .sort({ migratedAt: -1, _id: -1 })
    .limit(1)
    .lean();
  return one[0] ?? null;
}

/**
 * Approved visit years for this company (subset of {@link COMPANY_DETAIL_VISIT_YEARS}).
 * @param {import("mongoose").Types.ObjectId|string} companyId
 * @returns {Promise<number[]>}
 */
export async function getApprovedPlacementYearsForCompany(companyId) {
  const cid = toObjectId(companyId);
  if (!cid) return [];
  const allowed = new Set(COMPANY_DETAIL_VISIT_YEARS);
  const years = await CompanyVisit.distinct("year", {
    companyId: cid,
    status: "approved",
  });
  return years
    .map((y) => Number(y))
    .filter((y) => Number.isFinite(y) && allowed.has(y))
    .sort((a, b) => a - b);
}

/**
 * @param {import("mongoose").Types.ObjectId} companyId
 * @param {import("mongoose").Types.ObjectId|undefined|null} visitId
 * @param {number} [placementYear] when `visitId` is null, increment views for this year's approved visit
 */
export async function incrementVisitViews(companyId, visitId, placementYear) {
  if (visitId) {
    return CompanyVisit.updateOne({ _id: visitId }, { $inc: { views: 1 } });
  }
  const year =
    placementYear != null ? normalizeCompanyDetailYear(placementYear) : COMPANY_VISIT_YEAR;
  const v = await findLatestVisitForCompany(companyId, year);
  if (!v?._id) {
    return { acknowledged: true, modifiedCount: 0, matchedCount: 0 };
  }
  return CompanyVisit.updateOne({ _id: v._id }, { $inc: { views: 1 } });
}

/**
 * @param {string} id
 * @param {number} [placementYear] — must be normalized (see {@link normalizeCompanyDetailYear})
 * @returns {Promise<{ merged: Record<string, unknown> | null, visit: Record<string, unknown> | null, staticRow: Record<string, unknown> | null }>}
 */
export async function getCompanyDetailLegacyMergedById(
  id,
  placementYear = COMPANY_VISIT_YEAR
) {
  const _id = toObjectId(id);
  if (!_id) {
    return { merged: null, visit: null, staticRow: null };
  }
  const staticRow = await CompanyStatic.findOne({ _id }).lean();
  if (!staticRow) {
    return { merged: null, visit: null, staticRow: null };
  }
  const visitApproved = await findLatestVisitForCompany(_id, placementYear);
  if (visitApproved) {
    const merged = mergeToLegacyShape(staticRow, visitApproved);
    return { merged, visit: visitApproved, staticRow };
  }
  // No approved visit for this year: if any visit exists for that year (e.g. pending), match old API — 404
  const anyVisit = await findAnyLatestVisitForCompanyYear(_id, placementYear);
  if (anyVisit) {
    return { merged: null, visit: null, staticRow: null };
  }
  // No visit row for this year — legacy fallback: static only
  const merged = mergeToLegacyShape(staticRow, null);
  return { merged, visit: null, staticRow };
}

/**
 * One row per approved company across detail years (2026/2027), keeping only
 * one approved visit per company while preferring 2026 when present. This keeps
 * card ordering stable by 2026 visit dates, while still including 2027-only rows.
 * Uses one aggregation with `$lookup` on `companies` — avoids N+1.
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function listApprovedCompaniesLegacyMerged(
  placementYear = null
) {
  const yearFilter =
    placementYear == null
      ? { $in: COMPANY_DETAIL_VISIT_YEARS }
      : normalizeCompanyDetailYear(placementYear);
  const pipeline = [
    {
      $match: {
        year: yearFilter,
        status: "approved",
      },
    },
    { $sort: { year: 1, migratedAt: -1, _id: -1 } },
    {
      $group: {
        _id: "$companyId",
        visit: { $first: "$$ROOT" },
      },
    },
    {
      $lookup: {
        from: "companies",
        localField: "_id",
        foreignField: "_id",
        as: "c",
      },
    },
    { $match: { "c.0": { $exists: true } } },
    { $unwind: { path: "$c" } },
  ];

  const rows = await CompanyVisit.aggregate(pipeline);
  const list = [];
  for (const row of rows) {
    const staticRow = row.c;
    const visit = row.visit;
    if (!staticRow || !visit) continue;
    list.push(mergeToLegacyShape(staticRow, visit));
  }
  return list;
}

/**
 * Approved visits across detail years + static `companies` in one aggregation
 * (no N+1), minimal fields for category/logo previews. Prefers 2026 rows when
 * both years exist for a company; includes 2027-only companies.
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function listApprovedMinimalRowsForCategoryPreview(placementYear = null) {
  const yearFilter =
    placementYear == null
      ? { $in: COMPANY_DETAIL_VISIT_YEARS }
      : normalizeCompanyDetailYear(placementYear);
  const pipeline = [
    {
      $match: {
        year: yearFilter,
        status: "approved",
      },
    },
    { $sort: { year: 1, migratedAt: -1, _id: -1 } },
    {
      $group: {
        _id: "$companyId",
        visit: { $first: "$$ROOT" },
      },
    },
    {
      $lookup: {
        from: "companies",
        localField: "_id",
        foreignField: "_id",
        as: "c",
      },
    },
    { $match: { "c.0": { $exists: true } } },
    {
      $project: {
        _id: { $arrayElemAt: ["$c._id", 0] },
        name: { $arrayElemAt: ["$c.name", 0] },
        logo: { $arrayElemAt: ["$c.logo", 0] },
        type: "$visit.type",
        offCampus: { $eq: [{ $ifNull: ["$visit.offCampus", false] }, true] },
        roles: "$visit.roles",
        messageDate: "$visit.messageDate",
        updatedAt: "$visit.updatedAt",
        createdAt: "$visit.createdAt",
      },
    },
  ];

  const rows = await CompanyVisit.aggregate(pipeline);
  for (const row of rows) {
    flattenRoleCtcForJson(row);
  }
  return rows;
}

/**
 * Small JSON for 2026 category tiles: counts per bucket + up to 5 logo rows each.
 * @returns {Promise<{ counts: object, logos: object }>}
 */
export async function getCompanyCategoryPreviewLogos(placementYear = null) {
  const rows = await listApprovedMinimalRowsForCategoryPreview(placementYear);
  const withCategory = rows.map((c) => attachPlacementCategoryToCompany(c));
  const ordered = sortCompaniesForCategoryPreview(withCategory);
  return buildCategoryPreviewResponse(ordered, 5);
}

/**
 * Merge for admin edit flows: latest visit for `placementYear` (any status) + `companies` row.
 * @param {string} id
 * @param {number} [placementYear]
 * @returns {Promise<{ merged: Record<string, unknown> | null, staticRow: Record<string, unknown> | null, visit: Record<string, unknown> | null } | null>}
 */
export async function getCompanyMergedForAdminById(
  id,
  placementYear = COMPANY_VISIT_YEAR
) {
  const _id = toObjectId(id);
  if (!_id) {
    return { merged: null, staticRow: null, visit: null };
  }
  const staticRow = await CompanyStatic.findById(_id).lean();
  if (!staticRow) {
    return { merged: null, staticRow: null, visit: null };
  }
  const year = normalizeCompanyDetailYear(placementYear);
  const visit = await findAnyLatestVisitForCompanyYear(_id, year);
  const merged = mergeToLegacyShape(staticRow, visit);
  return { merged, staticRow, visit: visit ?? null };
}

/**
 * Creates an empty visit row for `placementYear` if missing (e.g. before persisting visit-only fields from admin).
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {number} [placementYear]
 */
export async function ensureAdminVisitForYear(
  companyId,
  placementYear = COMPANY_VISIT_YEAR
) {
  const cid = toObjectId(companyId);
  if (!cid) return null;
  const year = normalizeCompanyDetailYear(placementYear);
  const existing = await CompanyVisit.findOne({ companyId: cid, year });
  if (existing) return existing;
  return CompanyVisit.create({
    companyId: cid,
    year,
    migratedAt: new Date(),
  });
}

/**
 * Paginated admin company list from `companies` + `company_visits` (2026). When `status` is set, filters by visit status.
 * @param {{ status?: string, skip: number, limit: number }} opts
 * @returns {Promise<{ total: number, items: Record<string, unknown>[] }>}
 */
export async function listAdminPaginatedCompaniesFromSplit({ status, skip, limit }) {
  if (status) {
    const match = { year: COMPANY_VISIT_YEAR, status: String(status) };
    const pipeline = [
      { $match: match },
      { $sort: { migratedAt: -1, _id: -1 } },
      { $group: { _id: "$companyId", visit: { $first: "$$ROOT" } } },
      {
        $lookup: {
          from: "companies",
          localField: "_id",
          foreignField: "_id",
          as: "s",
        },
      },
      { $unwind: { path: "$s", preserveNullAndEmptyArrays: false } },
      { $addFields: { _sort: "$s.createdAt" } },
      { $sort: { _sort: -1, _id: -1 } },
      {
        $facet: {
          totalCount: [{ $count: "n" }],
          page: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ];
    const agg = await CompanyVisit.aggregate(pipeline);
    const facet = agg[0] || {};
    const total = facet.totalCount?.[0]?.n ?? 0;
    const page = facet.page || [];
    const items = page.map((row) => mergeToLegacyShape(row.s, row.visit));
    return { total, items };
  }
  const total = await CompanyStatic.countDocuments({});
  const statics = await CompanyStatic.find({})
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  const items = [];
  for (const s of statics) {
    const v = await findAnyLatestVisitForCompanyYear(/** @type {import("mongoose").Types.ObjectId} */ (s._id));
    items.push(mergeToLegacyShape(s, v));
  }
  return { total, items };
}

/**
 * Delete `company_visits` for this company then the `companies` row. Cache hooks run on models.
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @returns {Promise<{ ok: boolean }>}
 */
export async function deleteSplitCompany(companyId) {
  const cid = toObjectId(companyId);
  if (!cid) return { ok: false };
  await CompanyVisit.deleteMany({ companyId: cid });
  await CompanyStatic.deleteOne({ _id: cid });
  await invalidateCompanyDetailCache(cid);
  return { ok: true };
}

/**
 * Apply same atomic totalGotIn adjustment as legacy admin (floor at 0), on the visit for `placementYear`.
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {number} delta
 * @param {number} [placementYear]
 * @returns {Promise<{ _id: unknown, totalGotIn?: number } | null>}
 */
export async function adjustVisitTotalGotIn(
  companyId,
  delta,
  placementYear = COMPANY_VISIT_YEAR
) {
  const cid = toObjectId(companyId);
  if (!cid) return null;
  const d = Number(delta);
  if (Number.isNaN(d)) return null;
  const year = normalizeCompanyDetailYear(placementYear);
  const doc = await CompanyVisit.findOneAndUpdate(
    { companyId: cid, year },
    [
      {
        $set: {
          totalGotIn: {
            $max: [0, { $add: [{ $ifNull: ["$totalGotIn", 0] }, d] }],
          },
          migratedAt: new Date(),
        },
      },
    ],
    { new: true }
  ).select("_id totalGotIn");
  if (doc) await invalidateCompanyDetailCache(cid);
  return doc;
}

// ---------------------------------------------------------------------------
// WRITE operations (companies + company_visits only — never companies1)
// ---------------------------------------------------------------------------

/** Stored on `companies` (and accepted by static updates). */
const STATIC_STORAGE_KEY_SET = new Set([
  "name",
  "logo",
  "business_model",
  "must_do_topics",
  "about",
  "prev_coding_ques",
  "helpfulCount",
  "helpfulUsers",
  "nameKey",
  "submittedBy",
]);

/** Legacy / API keys → `companies` field names (no value coercion). */
const LEGACY_TO_STATIC = {
  Must_Do_Topics: "must_do_topics",
  "About The Company": "about",
};

const DYNAMIC_KEY_SET = new Set([
  "type",
  "eligibility",
  "roles",
  "onlineQuestions",
  "onlineQuestions_solution",
  "interviewQuestions",
  "interviewQuestions_solution",
  "interviewProcess",
  "selectedCandidates",
  "mcqQuestions",
  "internshipExperience",
  "count",
  "totalStudentsApplied",
  "totalClearedOA",
  "totalGotIn",
  "interview_difficulty_level",
  "difficulty_ratings",
  "difficulty_rating_count",
  "date_of_visit",
  "messageDate",
  "cluster",
  "views",
  "status",
  "offCampus",
  "approvedAt",
  "jobDescription",
]);

/**
 * @param {unknown} v
 * @returns {string}
 */
function nameKeyFromNameForWrite(v) {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}

/**
 * @param {Record<string, unknown>} o
 * @returns {Record<string, unknown>}
 */
function omitUndefinedWrite(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * @param {Record<string, unknown>} data
 * @param {{ forCreate?: boolean }} [opts]
 * @returns {{ staticDoc: Record<string, unknown>, dynamicDoc: Record<string, unknown> }}
 */
function splitStaticAndDynamicForWrite(data, opts = {}) {
  if (!data || typeof data !== "object") {
    return { staticDoc: {}, dynamicDoc: {} };
  }
  const staticDoc = /** @type {Record<string, unknown>} */ ({});
  const dynamicDoc = /** @type {Record<string, unknown>} */ ({});

  for (const [k, v] of Object.entries(data)) {
    if (
      k === "_id" ||
      k === "companyId" ||
      k === "year" ||
      k === "sourceCopyId" ||
      k === "migratedAt" ||
      k === "createdAt" ||
      k === "updatedAt"
    ) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(LEGACY_TO_STATIC, k)) {
      const target = LEGACY_TO_STATIC[/** @type {keyof typeof LEGACY_TO_STATIC} */ (k)];
      if (staticDoc[target] === undefined) {
        staticDoc[target] = v;
      }
      continue;
    }
    if (DYNAMIC_KEY_SET.has(k)) {
      dynamicDoc[k] = v;
      continue;
    }
    if (STATIC_STORAGE_KEY_SET.has(k)) {
      staticDoc[k] = v;
    }
  }

  if (opts.forCreate && staticDoc.name != null && staticDoc.nameKey === undefined) {
    staticDoc.nameKey = nameKeyFromNameForWrite(staticDoc.name);
  }

  return { staticDoc, dynamicDoc };
}

/**
 * Map legacy + storage keys to static column names. Only keys present in `data` are set.
 * @param {Record<string, unknown>} data
 * @param {{ recomputeNameKey?: boolean }} [opts]
 */
function pickStaticUpdatePayload(data, opts = {}) {
  if (!data || typeof data !== "object") return {};
  const out = /** @type {Record<string, unknown>} */ ({});

  for (const [k, v] of Object.entries(data)) {
    if (Object.prototype.hasOwnProperty.call(LEGACY_TO_STATIC, k)) {
      out[LEGACY_TO_STATIC[/** @type {keyof typeof LEGACY_TO_STATIC} */ (k)]] = v;
      continue;
    }
    if (STATIC_STORAGE_KEY_SET.has(k)) {
      out[k] = v;
    }
  }

  if (opts.recomputeNameKey && out.name !== undefined) {
    out.nameKey = nameKeyFromNameForWrite(out.name);
  }

  return omitUndefinedWrite(out);
}

/**
 * @param {Record<string, unknown>} data
 */
function pickDynamicUpdatePayload(data) {
  if (!data || typeof data !== "object") return {};
  const out = /** @type {Record<string, unknown>} */ ({});
  for (const k of DYNAMIC_KEY_SET) {
    if (Object.prototype.hasOwnProperty.call(data, k)) {
      out[k] = data[k];
    }
  }
  return omitUndefinedWrite(out);
}

/**
 * Insert one `companies` row and one `company_visits` row (year = COMPANY_VISIT_YEAR).
 * Values are written as given (no type coercion). `companies1` is never used.
 * @param {Record<string, unknown>} data - Full payload; split into static vs dynamic.
 * @returns {Promise<{ company: Record<string, unknown> | null, visit: Record<string, unknown> | null }>}
 */
export async function createCompanyWithVisit(data) {
  const { staticDoc: s0, dynamicDoc: d0 } = splitStaticAndDynamicForWrite(data, {
    forCreate: true,
  });
  const now = new Date();
  const staticDoc = omitUndefinedWrite({
    ...s0,
    createdAt: now,
    updatedAt: now,
  });

  const company = await CompanyStatic.create(staticDoc);
  const newCompanyId = company._id;

  const visitDoc = omitUndefinedWrite({
    ...d0,
    companyId: newCompanyId,
    year: COMPANY_VISIT_YEAR,
    migratedAt: now,
  });

  try {
    const vins = await CompanyVisit.create(visitDoc);
    const [companyRow, visit] = await Promise.all([
      CompanyStatic.findById(newCompanyId).lean(),
      CompanyVisit.findById(vins._id).lean(),
    ]);
    await invalidateCompanyDetailCache(newCompanyId);
    return { company: companyRow, visit };
  } catch (err) {
    await CompanyStatic.deleteOne({ _id: newCompanyId }).catch(() => {});
    throw err;
  }
}

/**
 * Update all `company_visits` for `companyId` + `placementYear` (same filter for every matching row).
 * Only dynamic fields from `data` are applied. Does not touch `companies`.
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {Record<string, unknown>} data
 * @param {number} [placementYear]
 * @returns {Promise<import("mongodb").UpdateResult>}
 */
export async function updateCompanyVisit(
  companyId,
  data,
  placementYear = COMPANY_VISIT_YEAR
) {
  const cid = toObjectId(companyId);
  if (!cid) {
    return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, matchedCount: 0 };
  }
  const $set = pickDynamicUpdatePayload(data);
  if (Object.keys($set).length === 0) {
    return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, matchedCount: 0 };
  }
  $set.migratedAt = new Date();
  const year = normalizeCompanyDetailYear(placementYear);
  const result = await CompanyVisit.updateMany(
    { companyId: cid, year },
    { $set: $set }
  );
  if (result.modifiedCount > 0) {
    await invalidateCompanyDetailCache(cid);
  }
  return result;
}

/**
 * Update one `companies` document by _id. Only static / helpful fields; legacy keys allowed.
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {Record<string, unknown>} data
 * @returns {Promise<import("mongodb").UpdateResult>}
 */
export async function updateCompanyStatic(companyId, data) {
  const cid = toObjectId(companyId);
  if (!cid) {
    return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, matchedCount: 0 };
  }
  const $set = pickStaticUpdatePayload(data, { recomputeNameKey: true });
  if (Object.keys($set).length === 0) {
    return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, matchedCount: 0 };
  }
  $set.updatedAt = new Date();
  const result = await CompanyStatic.updateOne({ _id: cid }, { $set });
  if (result.modifiedCount > 0) {
    await invalidateCompanyDetailCache(cid);
  }
  return result;
}

/**
 * Apply both static and visit updates from a single merged payload (each layer picks its fields only).
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {Record<string, unknown>} mergedPayload
 * @param {number} [placementYear] visit row to update (defaults to {@link COMPANY_VISIT_YEAR})
 */
export async function persistMergedCompany(
  companyId,
  mergedPayload,
  placementYear = COMPANY_VISIT_YEAR
) {
  await updateCompanyStatic(companyId, mergedPayload);
  await updateCompanyVisit(companyId, mergedPayload, placementYear);
}

/**
 * Idempotent: one vote per `userEmail`. Increments `helpfulCount` only if email not in `helpfulUsers`.
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {string} userEmail
 * @returns {Promise<{ updateResult: import("mongodb").UpdateResult, alreadyVoted: boolean }>}
 */
export async function addHelpfulVote(companyId, userEmail) {
  const cid = toObjectId(companyId);
  if (!cid || !userEmail || typeof userEmail !== "string") {
    return {
      updateResult: {
        acknowledged: true,
        modifiedCount: 0,
        upsertedCount: 0,
        matchedCount: 0,
      },
      alreadyVoted: false,
    };
  }

  const res = await CompanyStatic.updateOne(
    {
      _id: cid,
      $expr: {
        $not: {
          $in: [userEmail, { $ifNull: ["$helpfulUsers", []] }],
        },
      },
    },
    {
      $inc: { helpfulCount: 1 },
      $push: { helpfulUsers: userEmail },
    }
  );

  if (res.modifiedCount > 0) {
    await invalidateCompanyDetailCache(cid);
    return { updateResult: res, alreadyVoted: false };
  }
  const doc = await CompanyStatic.findOne({ _id: cid }).lean();
  if (!doc) {
    return { updateResult: res, alreadyVoted: false };
  }
  const arr = Array.isArray(doc.helpfulUsers) ? doc.helpfulUsers : [];
  return { updateResult: res, alreadyVoted: arr.includes(userEmail) };
}
