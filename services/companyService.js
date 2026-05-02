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
  companyHasAnyYearSummerInternshipListingFromVisits,
  companyHasAnyYearSummerPpoFromVisits,
  companyHasDreamTierVisitFromVisits,
  getCompanyDetailHeadlineTypeFromVisits,
  getListPlacementCategoryMetaFromVisits,
  getSummerPlacementPrefFromVisits,
  sortCompaniesForCategoryPreview,
  visitIsMarkedOffCampus,
  visitIsPpo,
  visitQualifiesDreamTierRow,
  visitQualifiesSummerInternshipListingRow,
} from "../utils/companyCategoryPreviewBuckets.js";
import {
  COMPANY_DETAIL_VISIT_YEARS,
  COMPANY_VISIT_DEFAULT_YEAR,
} from "../utils/placementYears.js";
import { invalidateCompanyDetailCache } from "./companyDetailCache.js";

export { COMPANY_DETAIL_VISIT_YEARS } from "../utils/placementYears.js";

/** @deprecated Use {@link COMPANY_VISIT_DEFAULT_YEAR} from `placementYears.js`; kept for imports. */
export const COMPANY_VISIT_YEAR = COMPANY_VISIT_DEFAULT_YEAR;

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

/**
 * Which placement list opened GET `/companies/:id` — selects among multiple approved visits for the same year.
 * @param {unknown} raw
 * @returns {"summer_internship"|"dream"|"open_dream"|null}
 */
export function normalizePlacementContextParam(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (s === "summer_internship") return "summer_internship";
  if (s === "dream") return "dream";
  if (s === "open_dream") return "open_dream";
  return null;
}

/**
 * Canonical `type` / `cluster` for `company_visits` composite uniqueness (empty string = default slot).
 * @param {unknown} type
 * @param {unknown} cluster
 * @returns {{ type: string, cluster: string }}
 */
export function normalizeVisitKeyParts(type, cluster) {
  return {
    type: type == null || String(type).trim() === "" ? "" : String(type).trim(),
    cluster:
      cluster == null || String(cluster).trim() === ""
        ? ""
        : String(cluster).trim(),
  };
}

/** Dropped from API responses; internal split-schema bookkeeping only. */
const INTERNAL_STRIP = ["sourceCopyId", "nameKey", "migratedAt"];

/** Stored on `companies` (CompanyStatic); visit overlay must not replace these keys. */
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
  "ppoConversionGotIn",
  "ppoConversionConverted",
  "ppoConversionAcceptanceRate",
  "ppoConversionType",
  "ppoConversionNotApplicable",
  "ppoBranchStats",
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
 * Match a visit row by company id even when external writers stored `companyId`
 * as a string instead of an ObjectId.
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @returns {Record<string, unknown>|null}
 */
function buildCompanyVisitCompanyExprMatch(companyId) {
  const cid = toObjectId(companyId);
  if (!cid) return null;
  return {
    $expr: {
      $eq: [{ $toString: "$companyId" }, String(cid)],
    },
  };
}

/**
 * Effective placement year for visit rows. External writers may omit `year`;
 * treat that as the default company visit year for admin/public reads.
 * @param {number} [placementYear]
 * @returns {Record<string, unknown>}
 */
function buildCompanyVisitYearExprMatch(placementYear = COMPANY_VISIT_YEAR) {
  const year = normalizeCompanyDetailYear(placementYear);
  return {
    $expr: {
      $eq: [{ $ifNull: ["$year", COMPANY_VISIT_YEAR] }, year],
    },
  };
}

/**
 * Match company visit rows by company + effective year, tolerating string `companyId`
 * and missing `year` from external writers like n8n.
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {number} [placementYear]
 * @returns {Record<string, unknown>|null}
 */
function buildCompanyVisitCompanyYearMatch(
  companyId,
  placementYear = COMPANY_VISIT_YEAR
) {
  const companyMatch = buildCompanyVisitCompanyExprMatch(companyId);
  if (!companyMatch) return null;
  return {
    $and: [companyMatch, buildCompanyVisitYearExprMatch(placementYear)],
  };
}

function visitEffectiveMatchYear(v) {
  return normalizeCompanyDetailYear(v?.year ?? COMPANY_VISIT_YEAR);
}

/** True iff an approved visit for this calendar `placementYear` qualifies for Dream / Open dream (on-campus non-PPO FTE-style). */
function hasDreamTierVisitForYear(allVisits, placementYear) {
  const y = normalizeCompanyDetailYear(placementYear);
  if (!Array.isArray(allVisits)) return false;
  return allVisits.some(
    (v) => visitEffectiveMatchYear(v) === y && visitQualifiesDreamTierRow(v)
  );
}

/** Approved row for `placementYear` is strict summer internship (on-campus PPO, no `fte` in `type`). */
function hasSummerInternshipListingVisitForYear(allVisits, placementYear) {
  const y = normalizeCompanyDetailYear(placementYear);
  if (!Array.isArray(allVisits)) return false;
  return allVisits.some(
    (v) =>
      visitEffectiveMatchYear(v) === y &&
      visitQualifiesSummerInternshipListingRow(v)
  );
}

function buildPlacementDreamTierVisitByYearMap(allVisits) {
  return Object.fromEntries(
    COMPANY_DETAIL_VISIT_YEARS.map((y) => [y, hasDreamTierVisitForYear(allVisits, y)])
  );
}

function buildPlacementSummerInternshipVisitByYearMap(allVisits) {
  return Object.fromEntries(
    COMPANY_DETAIL_VISIT_YEARS.map((y) => [
      y,
      hasSummerInternshipListingVisitForYear(allVisits, y),
    ])
  );
}

/**
 * Single visit row to mutate for (companyId, year): explicit hint, else latest by migratedAt/_id.
 * @param {import("mongoose").Types.ObjectId} cid
 * @param {number} placementYear
 * @param {Record<string, unknown>|null} [hintVisitDoc]
 */
async function resolveVisitAnchorDoc(cid, placementYear, hintVisitDoc = null) {
  const year = normalizeCompanyDetailYear(placementYear);
  if (hintVisitDoc && hintVisitDoc._id) {
    const byHint = await CompanyVisit.findOne({
      _id: hintVisitDoc._id,
      companyId: cid,
    })
      .select("_id")
      .lean();
    if (byHint) return byHint;
  }
  const match = buildCompanyVisitCompanyYearMatch(cid, year);
  if (!match) return null;
  const latest = await CompanyVisit.findOne(match)
    .sort({ migratedAt: -1, _id: -1 })
    .select("_id")
    .lean();
  return latest ?? null;
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
 * Lean visit doc → copy with plain-object `roles[].ctc` for CTC math (no DB writes).
 * @param {Record<string, unknown>|null|undefined} visit
 */
function visitWithPlainRoleCtc(visit) {
  if (!visit || typeof visit !== "object") return visit;
  const roles = Array.isArray(visit.roles)
    ? visit.roles.map((role) => {
        if (!role || typeof role !== "object") return role;
        const r = { ...role };
        if (r.ctc instanceof Map) r.ctc = Object.fromEntries(r.ctc);
        return r;
      })
    : visit.roles;
  return { ...visit, roles };
}

/**
 * All approved visits for placement-card years, grouped by companyId (read-only).
 * @param {import("mongoose").Types.ObjectId[]} companyIds
 */
async function fetchApprovedVisitsForDetailYearsByCompany(companyIds) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const map = new Map();
  if (!companyIds.length) return map;
  const visits = await CompanyVisit.find({
    companyId: { $in: companyIds },
    year: { $in: [...COMPANY_DETAIL_VISIT_YEARS] },
    status: "approved",
  }).lean();
  for (const v of visits) {
    const plain = visitWithPlainRoleCtc(v);
    const k = String(plain.companyId);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(plain);
  }
  return map;
}

/**
 * Which `company_visits` row drives merged list fields when multiple years exist.
 * @param {Record<string, unknown>[]|undefined} visits — approved rows for 2026/2027 (plain ctc)
 * @param {unknown} placementYearRaw — from `?year=`; null/undefined = prefer earliest year (2026-first)
 * @returns {Record<string, unknown>|null}
 */
function pickPrimaryVisitForListing(visits, placementYearRaw = null) {
  if (!Array.isArray(visits) || visits.length === 0) return null;
  const sorted = [...visits].sort((a, b) => {
    const ya = Number(a.year) || 0;
    const yb = Number(b.year) || 0;
    if (ya !== yb) return ya - yb;
    const ma = a.migratedAt ? new Date(a.migratedAt).getTime() : 0;
    const mb = b.migratedAt ? new Date(b.migratedAt).getTime() : 0;
    if (ma !== mb) return mb - ma;
    const ida = a._id ? String(a._id) : "";
    const idb = b._id ? String(b._id) : "";
    return ida.localeCompare(idb);
  });
  if (placementYearRaw == null || placementYearRaw === "") {
    return sorted[0];
  }
  const pref = normalizeCompanyDetailYear(placementYearRaw);
  const hit = sorted.find((v) => (Number(v.year) || 0) === pref);
  return hit ?? sorted[0];
}

/**
 * @param {Record<string, unknown>[]|undefined} visits
 * @returns {Record<number, number>} one totalGotIn slot per {@link COMPANY_DETAIL_VISIT_YEARS}
 */
function buildTotalGotInByYearFromVisits(visits) {
  const out = Object.fromEntries(
    COMPANY_DETAIL_VISIT_YEARS.map((y) => [y, 0])
  );
  if (!Array.isArray(visits) || visits.length === 0) return out;

  for (const year of COMPANY_DETAIL_VISIT_YEARS) {
    const perYear = visits
      .filter((v) => Number(v?.year) === year)
      .sort((a, b) => {
        const ma = a?.migratedAt ? new Date(a.migratedAt).getTime() : 0;
        const mb = b?.migratedAt ? new Date(b.migratedAt).getTime() : 0;
        if (ma !== mb) return mb - ma;
        const ida = a?._id ? String(a._id) : "";
        const idb = b?._id ? String(b._id) : "";
        return idb.localeCompare(ida);
      });
    const latest = perYear[0];
    out[year] = Number(latest?.totalGotIn) || 0;
  }

  return out;
}

/**
 * Placement-card classification should follow the selected year's primary approved visit,
 * not any historical approved visit for the same company.
 * @param {Record<string, unknown>|null|undefined} visit
 */
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
      if (STATIC_STORAGE_KEY_SET.has(key)) continue;
      if (Object.prototype.hasOwnProperty.call(LEGACY_TO_STATIC, key)) continue;
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
  const match = buildCompanyVisitCompanyYearMatch(companyId, year);
  if (!match) return null;
  const one = await CompanyVisit.find(match)
    .sort({ migratedAt: -1, _id: -1 })
    .limit(1)
    .lean();
  return one[0] ?? null;
}

/** @param {Record<string, unknown>} visit */
function visitTypeCompactLower(visit) {
  return String(visit?.type || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * Pick one row among candidates (already sorted newest-first) for placement hub context.
 * Shared by public detail merge + admin submission approval when multiple visits share a year.
 */
function pickVisitCandidateForPlacementContext(candidates, ctx) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  if (ctx === "summer_internship") {
    const strict = candidates.filter((v) => visitQualifiesSummerInternshipListingRow(v));
    if (strict.length > 0) return strict[0];
    const ppo = candidates.filter((v) => visitIsPpo(v) && !visitIsMarkedOffCampus(v));
    return ppo.length > 0 ? ppo[0] : candidates[0];
  }

  if (ctx === "dream" || ctx === "open_dream") {
    const fteRows = candidates.filter((v) => visitQualifiesDreamTierRow(v));
    if (fteRows.length > 0) return fteRows[0];
    const fteish = candidates.filter((v) => {
      if (visitIsMarkedOffCampus(v)) return false;
      return visitTypeCompactLower(v).includes("fte");
    });
    if (fteish.length > 0) return fteish[0];
    const nonPpo = candidates.filter((v) => !visitIsPpo(v) && !visitIsMarkedOffCampus(v));
    if (nonPpo.length > 0) return nonPpo[0];
    return candidates[0];
  }

  return candidates[0];
}

/**
 * Among all visit rows for (companyId, year), any status — pick the slot that matches Dream / Summer tier,
 * mirroring {@link findApprovedVisitForCompanyDetail}. Used when approving submissions tied to a hub tier.
 */
async function findAnyLatestVisitForCompanyYearMatchingContext(
  companyId,
  yearRaw,
  placementContextRaw
) {
  const ctx = normalizePlacementContextParam(placementContextRaw);
  const year = normalizeCompanyDetailYear(yearRaw);
  const match = buildCompanyVisitCompanyYearMatch(companyId, year);
  if (!match) return null;

  const candidatesRaw = await CompanyVisit.find(match)
    .sort({ migratedAt: -1, _id: -1 })
    .lean();

  if (!candidatesRaw.length) return null;

  const candidates = candidatesRaw.map((v) => visitWithPlainRoleCtc(v));
  return pickVisitCandidateForPlacementContext(candidates, ctx);
}

/**
 * Latest approved visit for the year (used for public detail + list merge).
 * @param {import("mongoose").Types.ObjectId} companyId
 * @param {number} [year]
 */
export async function findLatestVisitForCompany(companyId, year = COMPANY_VISIT_YEAR) {
  const match = buildCompanyVisitCompanyYearMatch(companyId, year);
  if (!match) return null;
  const one = await CompanyVisit.find({
    status: "approved",
    ...match,
  })
    .sort({ migratedAt: -1, _id: -1 })
    .limit(1)
    .lean();
  return one[0] ?? null;
}

/**
 * Approved row for GET `/companies/:id` when several visits share `companyId` + year (distinct type/cluster slots).
 */
async function findApprovedVisitForCompanyDetail(
  companyId,
  yearRaw,
  placementContextRaw = null
) {
  const ctx = normalizePlacementContextParam(placementContextRaw);
  const year = normalizeCompanyDetailYear(yearRaw);
  const match = buildCompanyVisitCompanyYearMatch(companyId, year);
  if (!match) return null;

  const candidatesRaw = await CompanyVisit.find({
    status: "approved",
    ...match,
  })
    .sort({ migratedAt: -1, _id: -1 })
    .lean();

  if (!candidatesRaw.length) return null;

  const candidates = candidatesRaw.map((v) => visitWithPlainRoleCtc(v));
  return pickVisitCandidateForPlacementContext(candidates, ctx);
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
  placementYear = COMPANY_VISIT_YEAR,
  placementContextRaw = null
) {
  const ctx = normalizePlacementContextParam(placementContextRaw);
  const _id = toObjectId(id);
  if (!_id) {
    return { merged: null, visit: null, staticRow: null };
  }
  const staticRow = await CompanyStatic.findOne({ _id }).lean();
  if (!staticRow) {
    return { merged: null, visit: null, staticRow: null };
  }
  const visitsByCompany = await fetchApprovedVisitsForDetailYearsByCompany([_id]);
  const allApprovedVisits = visitsByCompany.get(String(_id)) ?? [];
  const totalGotInByYear = buildTotalGotInByYearFromVisits(allApprovedVisits);
  const visitApproved = await findApprovedVisitForCompanyDetail(
    _id,
    placementYear,
    placementContextRaw
  );
  if (visitApproved) {
    const merged = {
      ...mergeToLegacyShape(staticRow, visitApproved),
      totalGotInByYear,
    };
    const visitPlain = visitWithPlainRoleCtc(visitApproved);
    const headline = getCompanyDetailHeadlineTypeFromVisits(
      allApprovedVisits,
      visitPlain,
      placementYear
    );
    if (headline) merged.placementDetailHeadlineType = headline;
    merged.placementDreamTierVisitMissingForYear =
      ctx === "dream" || ctx === "open_dream"
        ? !hasDreamTierVisitForYear(allApprovedVisits, placementYear)
        : false;
    merged.placementDreamTierVisitByYear =
      buildPlacementDreamTierVisitByYearMap(allApprovedVisits);
    merged.placementSummerInternshipVisitMissingForYear =
      ctx === "summer_internship"
        ? !hasSummerInternshipListingVisitForYear(allApprovedVisits, placementYear)
        : false;
    merged.placementSummerInternshipVisitByYear =
      buildPlacementSummerInternshipVisitByYearMap(allApprovedVisits);
    return { merged, visit: visitApproved, staticRow };
  }
  // No approved visit for this year: if any visit exists for that year (e.g. pending), match old API — 404
  const anyVisit = await findAnyLatestVisitForCompanyYear(_id, placementYear);
  if (anyVisit) {
    return { merged: null, visit: null, staticRow: null };
  }
  // No visit row for this year — legacy fallback: static only
  const merged = {
    ...mergeToLegacyShape(staticRow, null),
    totalGotInByYear,
  };
  merged.placementDreamTierVisitMissingForYear =
    ctx === "dream" || ctx === "open_dream"
      ? !hasDreamTierVisitForYear(allApprovedVisits, placementYear)
      : false;
  merged.placementDreamTierVisitByYear =
    buildPlacementDreamTierVisitByYearMap(allApprovedVisits);
  merged.placementSummerInternshipVisitMissingForYear =
    ctx === "summer_internship"
      ? !hasSummerInternshipListingVisitForYear(allApprovedVisits, placementYear)
      : false;
  merged.placementSummerInternshipVisitByYear =
    buildPlacementSummerInternshipVisitByYearMap(allApprovedVisits);
  return { merged, visit: null, staticRow };
}

/**
 * One row per approved company that has any visit in {@link COMPANY_DETAIL_VISIT_YEARS}.
 * `placementYear` picks which visit merges into the card when that year exists; otherwise
 * the other year is used (so 2027-only companies still appear when `?year=2026`).
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function listApprovedCompaniesLegacyMerged(
  placementYear = null
) {
  const pipeline = [
    {
      $match: {
        year: { $in: [...COMPANY_DETAIL_VISIT_YEARS] },
        status: "approved",
      },
    },
    { $group: { _id: "$companyId" } },
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
  const companyIds = rows.map((r) => r._id);
  const visitsByCompany = await fetchApprovedVisitsForDetailYearsByCompany(companyIds);

  const list = [];
  for (const row of rows) {
    const staticRow = row.c;
    if (!staticRow) continue;
    const allVisits = visitsByCompany.get(String(row._id)) ?? [];
    const totalGotInByYear = buildTotalGotInByYearFromVisits(allVisits);
    const visit = pickPrimaryVisitForListing(allVisits, placementYear);
    if (!visit) continue;
    const merged = mergeToLegacyShape(staticRow, visit);
    const placementAnyYearPpoOnCampus = companyHasAnyYearSummerPpoFromVisits(allVisits);
    const placementHasDreamTierVisit = companyHasDreamTierVisitFromVisits(allVisits);
    const listingYearNorm =
      placementYear != null && placementYear !== ""
        ? normalizeCompanyDetailYear(placementYear)
        : null;
    const placementDreamTierForListingYear =
      listingYearNorm == null
        ? placementHasDreamTierVisit
        : hasDreamTierVisitForYear(allVisits, listingYearNorm);
    /** Strict internship(PPO) row in 2026 or 2027 — hub membership must not drop sibling-year-only visits when `?year=` is set. */
    const placementSummerInternshipForListingYear =
      companyHasAnyYearSummerInternshipListingFromVisits(allVisits);
    /** Per listing year: whether that year has a strict summer row (card label; mirrors dream-tier listing flag). */
    const placementSummerStrictVisitForListingYear =
      listingYearNorm == null
        ? placementSummerInternshipForListingYear
        : hasSummerInternshipListingVisitForYear(allVisits, listingYearNorm);
    const placementMeta = getListPlacementCategoryMetaFromVisits(
      allVisits,
      visitWithPlainRoleCtc(visit),
      placementYear
    );
    const {
      dreamDisplayType: placementDreamDisplayType,
      dreamDetailYear: placementDreamDetailYear,
      ...catMeta
    } = placementMeta;
    const summerPref = getSummerPlacementPrefFromVisits(allVisits, placementYear);
    list.push({
      ...merged,
      totalGotInByYear,
      category: catMeta.category,
      totalCtcRupees: catMeta.totalCtcRupees,
      placementAnyYearPpoOnCampus,
      placementHasDreamTierVisit,
      placementDreamTierForListingYear,
      placementSummerInternshipForListingYear,
      placementSummerStrictVisitForListingYear,
      placementDreamDisplayType,
      placementDreamDetailYear,
      placementSummerDisplayType: summerPref.displayType,
      placementSummerDetailYear: summerPref.detailYear,
    });
  }
  return list;
}

/**
 * Minimal fields for category/logo previews — same inclusion rules as
 * {@link listApprovedCompaniesLegacyMerged} (any approved year in range).
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function listApprovedMinimalRowsForCategoryPreview(placementYear = null) {
  const pipeline = [
    {
      $match: {
        year: { $in: [...COMPANY_DETAIL_VISIT_YEARS] },
        status: "approved",
      },
    },
    { $group: { _id: "$companyId" } },
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
  const companyIds = rows.map((r) => r._id);
  const visitsByCompany = await fetchApprovedVisitsForDetailYearsByCompany(companyIds);

  const out = [];
  for (const row of rows) {
    const staticRow = row.c;
    if (!staticRow) continue;
    const allVisits = visitsByCompany.get(String(row._id)) ?? [];
    const primary = pickPrimaryVisitForListing(allVisits, placementYear);
    if (!primary) continue;

    const minimal = {
      _id: staticRow._id,
      name: staticRow.name,
      logo: staticRow.logo,
      type: primary.type,
      offCampus: primary.offCampus === true,
      roles: primary.roles,
      messageDate: primary.messageDate,
      updatedAt: primary.updatedAt,
      createdAt: primary.createdAt,
    };
    flattenRoleCtcForJson(minimal);

    const primaryVisit = {
      type: minimal.type,
      year: primary.year,
      offCampus: minimal.offCampus,
      roles: minimal.roles,
    };
    const placementAnyYearPpoOnCampus =
      companyHasAnyYearSummerPpoFromVisits(allVisits);
    const placementHasDreamTierVisit =
      companyHasDreamTierVisitFromVisits(allVisits);
    const listingYearNorm =
      placementYear != null && placementYear !== ""
        ? normalizeCompanyDetailYear(placementYear)
        : null;
    const placementDreamTierForListingYear =
      listingYearNorm == null
        ? placementHasDreamTierVisit
        : hasDreamTierVisitForYear(allVisits, listingYearNorm);
    /** Strict internship(PPO) row in 2026 or 2027 — hub membership must not drop sibling-year-only visits when `?year=` is set. */
    const placementSummerInternshipForListingYear =
      companyHasAnyYearSummerInternshipListingFromVisits(allVisits);
    const placementSummerStrictVisitForListingYear =
      listingYearNorm == null
        ? placementSummerInternshipForListingYear
        : hasSummerInternshipListingVisitForYear(allVisits, listingYearNorm);

    const placementMeta = getListPlacementCategoryMetaFromVisits(
      allVisits,
      primaryVisit,
      placementYear
    );
    const {
      dreamDisplayType: placementDreamDisplayType,
      dreamDetailYear: placementDreamDetailYear,
      ...catMeta
    } = placementMeta;
    const summerPref = getSummerPlacementPrefFromVisits(allVisits, placementYear);
    minimal.category = catMeta.category;
    minimal.totalCtcRupees = catMeta.totalCtcRupees;
    minimal.placementDreamDisplayType = placementDreamDisplayType;
    minimal.placementDreamDetailYear = placementDreamDetailYear;
    minimal.placementSummerDisplayType = summerPref.displayType;
    minimal.placementSummerDetailYear = summerPref.detailYear;
    minimal.placementAnyYearPpoOnCampus = placementAnyYearPpoOnCampus;
    minimal.placementHasDreamTierVisit = placementHasDreamTierVisit;
    minimal.placementDreamTierForListingYear = placementDreamTierForListingYear;
    minimal.placementSummerInternshipForListingYear =
      placementSummerInternshipForListingYear;
    minimal.placementSummerStrictVisitForListingYear =
      placementSummerStrictVisitForListingYear;
    out.push(minimal);
  }
  return out;
}

/**
 * Small JSON for 2026 category tiles: counts per bucket + up to 5 logo rows each.
 * @returns {Promise<{ counts: object, logos: object }>}
 */
export async function getCompanyCategoryPreviewLogos(placementYear = null) {
  const rows = await listApprovedMinimalRowsForCategoryPreview(placementYear);
  const withCategory = rows.map((c) => {
    const base = attachPlacementCategoryToCompany(c);
    return {
      ...base,
      category: c.category,
      totalCtcRupees: c.totalCtcRupees,
      placementAnyYearPpoOnCampus: c.placementAnyYearPpoOnCampus,
      placementHasDreamTierVisit: c.placementHasDreamTierVisit,
      placementDreamDisplayType: c.placementDreamDisplayType,
      placementDreamDetailYear: c.placementDreamDetailYear,
      placementSummerDisplayType: c.placementSummerDisplayType,
      placementSummerDetailYear: c.placementSummerDetailYear,
    };
  });
  const ordered = sortCompaniesForCategoryPreview(withCategory);
  return buildCategoryPreviewResponse(ordered, 5);
}

/**
 * Merge for admin edit flows: latest visit for `placementYear` (any status) + `companies` row.
 * @param {string} id
 * @param {number} [placementYear]
 * @param {string|null|undefined} [placementListContext] — when set (dream / open_dream / summer_internship), selects among multiple visit rows for that year.
 * @param {string|import("mongoose").Types.ObjectId|null|undefined} [companyVisitIdHint] — optional exact `company_visits` row (must match company + placement year).
 * @returns {Promise<{ merged: Record<string, unknown> | null, staticRow: Record<string, unknown> | null, visit: Record<string, unknown> | null } | null>}
 */
export async function getCompanyMergedForAdminById(
  id,
  placementYear = COMPANY_VISIT_YEAR,
  placementListContext = null,
  companyVisitIdHint = null
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
  const visitHintOid = toObjectId(companyVisitIdHint);
  let visit = null;
  if (visitHintOid) {
    const hit = await CompanyVisit.findOne({
      _id: visitHintOid,
      companyId: _id,
    }).lean();
    if (hit && visitEffectiveMatchYear(hit) === year) {
      visit = visitWithPlainRoleCtc(hit);
    }
  }
  if (!visit) {
    const ctxTrim =
      placementListContext != null && String(placementListContext).trim() !== ""
        ? String(placementListContext).trim()
        : null;
    visit =
      ctxTrim != null
        ? await findAnyLatestVisitForCompanyYearMatchingContext(_id, year, ctxTrim)
        : await findAnyLatestVisitForCompanyYear(_id, year);
  }
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
  const match = buildCompanyVisitCompanyYearMatch(cid, year);
  const existing = match
    ? await CompanyVisit.findOne(match).sort({ migratedAt: -1, _id: -1 })
    : null;
  if (existing) return existing;
  const { type, cluster } = normalizeVisitKeyParts("", "");
  return CompanyVisit.create({
    companyId: cid,
    year,
    type,
    cluster,
    migratedAt: new Date(),
  });
}

/**
 * Paginated admin company list from `companies` + `company_visits`.
 * When `status` is set, filters by visit status and optionally by visit year.
 * `placementYear = null` means "all supported placement years".
 * @param {{ status?: string, skip: number, limit: number, placementYear?: number|null|string }} opts
 * @returns {Promise<{ total: number, items: Record<string, unknown>[] }>}
 */
export async function listAdminPaginatedCompaniesFromSplit({
  status,
  skip,
  limit,
  placementYear = COMPANY_VISIT_YEAR,
}) {
  const useAllYears =
    placementYear == null ||
    placementYear === "" ||
    String(placementYear).toLowerCase() === "all";
  const year = useAllYears ? null : normalizeCompanyDetailYear(placementYear);
  if (status) {
    /** One admin row per `company_visits` document (same company + year can have FTE + PPO slots). */
    const pipeline = [
      {
        $addFields: {
          companyIdForJoin: {
            $convert: { input: "$companyId", to: "objectId", onError: null, onNull: null },
          },
          effectiveYear: { $ifNull: ["$year", COMPANY_VISIT_YEAR] },
        },
      },
      {
        $match: {
          status: String(status),
          companyIdForJoin: { $ne: null },
          effectiveYear:
            year == null ? { $in: [...COMPANY_DETAIL_VISIT_YEARS] } : year,
        },
      },
      { $sort: { migratedAt: -1, _id: -1 } },
      {
        $lookup: {
          from: "companies",
          localField: "companyIdForJoin",
          foreignField: "_id",
          as: "s",
        },
      },
      { $unwind: { path: "$s", preserveNullAndEmptyArrays: false } },
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
    const STRIP_ROW_KEYS = new Set([
      "s",
      "companyIdForJoin",
      "effectiveYear",
    ]);
    const items = page.map((row) => {
      const staticRow = row.s;
      const placementYearNum = Number(row.effectiveYear) || null;
      const visitForMerge = {};
      for (const [k, v] of Object.entries(row)) {
        if (!STRIP_ROW_KEYS.has(k)) visitForMerge[k] = v;
      }
      const companyVisitId = visitForMerge._id;
      return {
        ...mergeToLegacyShape(staticRow, visitForMerge),
        placementYear: placementYearNum,
        companyVisitId: companyVisitId != null ? String(companyVisitId) : null,
      };
    });
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
    const v = await findAnyLatestVisitForCompanyYear(
      /** @type {import("mongoose").Types.ObjectId} */ (s._id),
      year == null ? COMPANY_VISIT_YEAR : year
    );
    items.push({
      ...mergeToLegacyShape(s, v),
      placementYear: Number(v?.year ?? (year == null ? COMPANY_VISIT_YEAR : year)) || null,
    });
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
  const visitMatch = buildCompanyVisitCompanyExprMatch(cid);
  if (!visitMatch) return { ok: false };
  await CompanyVisit.deleteMany(visitMatch);
  await CompanyStatic.deleteOne({ _id: cid });
  await invalidateCompanyDetailCache(cid);
  return { ok: true };
}

/**
 * Delete one `company_visits` row. If no visits remain for the company, also delete the static row.
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {number} [placementYear]
 * @param {string|import("mongoose").Types.ObjectId|null|undefined} [companyVisitIdHint] — delete this row when set (must belong to company + year).
 * @param {{ requireStatus?: string }} [options] — when set, only delete if visit.status matches (e.g. pending vs approved).
 * @returns {Promise<{ ok: boolean, deletedVisit: boolean, deletedCompany: boolean, wrongStatus?: boolean }>}
 */
export async function deleteCompanyVisitForYear(
  companyId,
  placementYear = COMPANY_VISIT_YEAR,
  companyVisitIdHint = null,
  options = {}
) {
  const { requireStatus } = options;
  const cid = toObjectId(companyId);
  if (!cid) return { ok: false, deletedVisit: false, deletedCompany: false };
  const match = buildCompanyVisitCompanyYearMatch(cid, placementYear);
  if (!match) return { ok: false, deletedVisit: false, deletedCompany: false };

  const yearNorm = normalizeCompanyDetailYear(placementYear);
  const vid = toObjectId(companyVisitIdHint);

  let visitToDelete = null;

  if (vid) {
    const doc = await CompanyVisit.findById(vid).select("_id companyId year status").lean();
    if (
      !doc?._id ||
      String(doc.companyId) !== String(cid) ||
      normalizeCompanyDetailYear(doc.year) !== yearNorm
    ) {
      return { ok: false, deletedVisit: false, deletedCompany: false };
    }
    if (requireStatus === "pending") {
      if (doc.status === "approved") {
        return {
          ok: false,
          deletedVisit: false,
          deletedCompany: false,
          wrongStatus: true,
        };
      }
    } else if (requireStatus === "approved" && doc.status !== "approved") {
      return {
        ok: false,
        deletedVisit: false,
        deletedCompany: false,
        wrongStatus: true,
      };
    } else if (
      requireStatus != null &&
      requireStatus !== "pending" &&
      requireStatus !== "approved" &&
      doc.status !== requireStatus
    ) {
      return {
        ok: false,
        deletedVisit: false,
        deletedCompany: false,
        wrongStatus: true,
      };
    }
    visitToDelete = doc;
  } else {
    let filter = match;
    if (requireStatus === "pending") {
      filter = { $and: [match, { $nor: [{ status: "approved" }] }] };
    } else if (requireStatus === "approved") {
      filter = { $and: [match, { status: "approved" }] };
    } else if (requireStatus != null) {
      filter = { $and: [match, { status: requireStatus }] };
    }
    visitToDelete = await CompanyVisit.findOne(filter)
      .sort({ migratedAt: -1, _id: -1 })
      .select("_id")
      .lean();
    if (!visitToDelete?._id) {
      return { ok: false, deletedVisit: false, deletedCompany: false };
    }
  }

  const visitDelete = await CompanyVisit.deleteOne({ _id: visitToDelete._id });
  const deletedVisit = (visitDelete?.deletedCount ?? 0) > 0;
  if (!deletedVisit) {
    return { ok: false, deletedVisit: false, deletedCompany: false };
  }

  const anyYearMatch = buildCompanyVisitCompanyExprMatch(cid);
  const remainingVisits = anyYearMatch
    ? await CompanyVisit.countDocuments(anyYearMatch)
    : 0;
  let deletedCompany = false;
  if (remainingVisits === 0) {
    const staticDelete = await CompanyStatic.deleteOne({ _id: cid });
    deletedCompany = (staticDelete?.deletedCount ?? 0) > 0;
  }

  await invalidateCompanyDetailCache(cid);
  return { ok: true, deletedVisit: true, deletedCompany };
}

/**
 * Latest pending visit row for (companyId, placementYear), if any.
 */
export async function findOnePendingVisitForCompanyYear(
  companyId,
  placementYear = COMPANY_VISIT_YEAR
) {
  const cid = toObjectId(companyId);
  if (!cid) return null;
  const match = buildCompanyVisitCompanyYearMatch(cid, placementYear);
  if (!match) return null;
  /** Rows without `status` are treated like pending (legacy / external inserts). */
  return CompanyVisit.findOne({
    $and: [match, { $nor: [{ status: "approved" }] }],
  })
    .sort({ migratedAt: -1, _id: -1 })
    .lean();
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
  const anchor = await resolveVisitAnchorDoc(cid, placementYear, null);
  if (!anchor?._id) return null;
  const doc = await CompanyVisit.findByIdAndUpdate(
    anchor._id,
    [
      {
        $set: {
          totalGotIn: {
            $max: [0, { $add: [{ $ifNull: ["$totalGotIn", 0] }, d] }],
          },
          year,
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

  const keyParts = normalizeVisitKeyParts(d0.type, d0.cluster);
  const visitDoc = omitUndefinedWrite({
    ...d0,
    companyId: newCompanyId,
    year: COMPANY_VISIT_YEAR,
    type: keyParts.type,
    cluster: keyParts.cluster,
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
 * Update one anchored `company_visits` row for `companyId` + `placementYear`.
 * Only dynamic fields from `data` are applied. Does not touch `companies`.
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {Record<string, unknown>} data
 * @param {number} [placementYear]
 * @param {Record<string, unknown>|null} [hintVisitDoc]
 * @returns {Promise<import("mongodb").UpdateResult>}
 */
export async function updateCompanyVisit(
  companyId,
  data,
  placementYear = COMPANY_VISIT_YEAR,
  hintVisitDoc = null
) {
  const cid = toObjectId(companyId);
  if (!cid) {
    return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, matchedCount: 0 };
  }
  const $set = pickDynamicUpdatePayload(data);
  if (Object.keys($set).length === 0) {
    return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, matchedCount: 0 };
  }
  const year = normalizeCompanyDetailYear(placementYear);
  $set.migratedAt = new Date();
  $set.year = year;
  const anchor = await resolveVisitAnchorDoc(cid, placementYear, hintVisitDoc);
  if (!anchor?._id) {
    return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, matchedCount: 0 };
  }
  const result = await CompanyVisit.updateOne({ _id: anchor._id }, { $set });
  if (result.modifiedCount > 0) {
    await invalidateCompanyDetailCache(cid);
  }
  return result;
}

/**
 * Normalize one company visit row during admin approval so externally inserted rows
 * (e.g. n8n) are brought into canonical shape without a separate DB migration.
 * This explicitly:
 * - stores `companyId` as an ObjectId
 * - stores `year` on the row
 * - marks status as approved
 * - backfills all modeled `company_visits` fields when they are missing
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {number} [placementYear]
 * @param {Date} [approvedAt]
 * @returns {Promise<import("mongodb").UpdateResult>}
 */
export async function approveAndNormalizeSingleCompanyVisitById(
  visitObjectId,
  approvedAt = new Date()
) {
  const oid = toObjectId(visitObjectId);
  if (!oid) {
    return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, matchedCount: 0 };
  }

  const existing = await CompanyVisit.findById(oid).lean();
  if (!existing) {
    return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, matchedCount: 0 };
  }

  const cid = toObjectId(existing.companyId);
  if (!cid) {
    return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, matchedCount: 0 };
  }

  const year = normalizeCompanyDetailYear(existing.year);

  const $set = {
    companyId: cid,
    year,
    type: existing.type != null ? String(existing.type) : "",
    roles: Array.isArray(existing.roles) ? existing.roles : [],
    onlineQuestions: Array.isArray(existing.onlineQuestions) ? existing.onlineQuestions : [],
    onlineQuestions_solution: Array.isArray(existing.onlineQuestions_solution)
      ? existing.onlineQuestions_solution
      : [],
    interviewQuestions: Array.isArray(existing.interviewQuestions)
      ? existing.interviewQuestions
      : [],
    interviewQuestions_solution: Array.isArray(existing.interviewQuestions_solution)
      ? existing.interviewQuestions_solution
      : [],
    interviewProcess: Array.isArray(existing.interviewProcess) ? existing.interviewProcess : [],
    eligibility: existing.eligibility != null ? String(existing.eligibility) : "",
    date_of_visit: existing.date_of_visit != null ? String(existing.date_of_visit) : "",
    messageDate: existing.messageDate ?? null,
    cluster: existing.cluster != null ? String(existing.cluster) : "",
    count: existing.count != null ? String(existing.count) : "",
    selectedCandidates: Array.isArray(existing.selectedCandidates)
      ? existing.selectedCandidates
      : [],
    status: "approved",
    totalClearedOA: Number(existing.totalClearedOA) || 0,
    totalGotIn: Number(existing.totalGotIn) || 0,
    totalStudentsApplied: Number(existing.totalStudentsApplied) || 0,
    views: Number(existing.views) || 0,
    internshipExperience: Array.isArray(existing.internshipExperience)
      ? existing.internshipExperience
      : [],
    mcqQuestions: Array.isArray(existing.mcqQuestions) ? existing.mcqQuestions : [],
    approvedAt,
    migratedAt: new Date(),
  };

  const result = await CompanyVisit.updateOne({ _id: oid }, { $set });

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
  placementYear = COMPANY_VISIT_YEAR,
  placementListContext = null,
  companyVisitIdHint = null
) {
  await updateCompanyStatic(companyId, mergedPayload);
  await ensureAdminVisitForYear(companyId, placementYear);
  const { visit } = await getCompanyMergedForAdminById(
    companyId,
    placementYear,
    placementListContext,
    companyVisitIdHint
  );
  await updateCompanyVisit(companyId, mergedPayload, placementYear, visit);
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
