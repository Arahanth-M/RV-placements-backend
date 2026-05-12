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
  normalizeType,
  visitQualifiesDreamHubListingVisit,
  visitQualifiesDreamTierRow,
  visitQualifiesInternshipOnlyHubRow,
  visitQualifiesSummerInternshipListingRow,
} from "../utils/companyCategoryPreviewBuckets.js";
import {
  COMPANY_DETAIL_VISIT_YEARS,
  COMPANY_VISIT_DEFAULT_YEAR,
} from "../utils/placementYears.js";
import {
  clusterKeyFromPlacementVisitClusterField,
  normalizePlacementClusterQuery,
} from "../utils/placementCluster.js";
import { PPO_BRANCH_CODES, PPO_BRANCH_CODES_ARRAY } from "../utils/ppoBranchCodes.js";
import escapeRegexLiteral from "../utils/regexEscape.js";
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
 * Placement year for AI mock slice — uses the selected visit row year (not limited to detail-card years).
 * @param {unknown} raw
 * @returns {number}
 */
export function normalizePlacementVisitYear(raw) {
  if (raw == null || raw === "") return COMPANY_VISIT_YEAR;
  const n = Number(raw);
  if (!Number.isFinite(n)) return COMPANY_VISIT_YEAR;
  const y = Math.trunc(n);
  if (y < 2000 || y > 2100) return COMPANY_VISIT_YEAR;
  return y;
}

/**
 * Which placement list opened GET `/companies/:id` — selects among multiple approved visits for the same year.
 * @param {unknown} raw
 * @returns {"summer_internship"|"dream"|"open_dream"|"off_campus"|"internship_only"|null}
 */
export function normalizePlacementContextParam(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (s === "summer_internship") return "summer_internship";
  if (s === "dream") return "dream";
  if (s === "open_dream") return "open_dream";
  if (s === "off_campus") return "off_campus";
  if (s === "internship_only") return "internship_only";
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
  "about",
  "prev_coding_ques",
  "helpfulCount",
  "helpfulUsers",
  "nameKey",
  "submittedBy",
]);

/** Legacy / API keys → `companies` field names (no value coercion). */
const LEGACY_TO_STATIC = {
  "About The Company": "about",
};

/** Legacy / API keys → `company_visits` field names (no value coercion). */
const LEGACY_TO_DYNAMIC = {
  Must_Do_Topics: "must_do_topics",
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
  "must_do_topics",
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
  "placementGotInBranchStats",
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

/**
 * Same calendar year may have several approved `company_visits` rows. `placementContext` picks one
 * row for tab merge, but another row may hold `date_of_visit`. Pick a single string for API JSON so
 * default `?year=` clients see the same visit date as hub-linked clients when another slot has it.
 * @param {Record<string, unknown>|null|undefined} visitApproved
 * @param {Record<string, unknown>[]|undefined} allApprovedVisits
 * @param {number} placementYear
 * @returns {string}
 */
function mergedDateOfVisitForApi(visitApproved, allApprovedVisits, placementYear) {
  const y = normalizeCompanyDetailYear(placementYear);
  const sameYear = (Array.isArray(allApprovedVisits)
    ? allApprovedVisits.filter((v) => visitEffectiveMatchYear(v) === y)
    : []
  ).sort((a, b) => {
    const ma = a.migratedAt ? new Date(a.migratedAt).getTime() : 0;
    const mb = b.migratedAt ? new Date(b.migratedAt).getTime() : 0;
    if (ma !== mb) return mb - ma;
    const ida = a._id ? String(a._id) : "";
    const idb = b._id ? String(b._id) : "";
    return ida.localeCompare(idb);
  });

  /** @type {Record<string, unknown>[]} */
  const ordered = [];
  if (visitApproved && typeof visitApproved === "object" && visitApproved._id) {
    ordered.push(visitApproved);
    for (const v of sameYear) {
      if (v?._id && String(v._id) !== String(visitApproved._id)) ordered.push(v);
    }
  } else {
    for (const v of sameYear) ordered.push(v);
  }

  for (const v of ordered) {
    const raw = v?.date_of_visit;
    const s = raw == null ? "" : String(raw).trim();
    if (s && !/^(tba|tbd)$/i.test(s)) return s;
  }
  for (const v of ordered) {
    const raw = v?.date_of_visit;
    const s = raw == null ? "" : String(raw).trim();
    if (s) return s;
  }
  return "";
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
    return normalizeRoleStipendFields(r);
  });
}

function stipendNormalizedMapKey(key) {
  return String(key ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

/** Parse internship stipend from SPC / free-text stipend fields → rupees number (undefined if invalid). */
function stipendSubmissionStringToNumber(stipStr) {
  const s = String(stipStr ?? "").trim().replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Hoist stipend-like keys out of `role.ctc` into top-level numeric `internshipStipend` (canonical for APIs/UI).
 * Removes `Stipend` / `internshipStipend` keys from `ctc` so list/detail views show one stipend field.
 */
export function normalizeRoleStipendFields(role) {
  if (!role || typeof role !== "object") return role;
  const r = { ...role };
  const ctc =
    r.ctc instanceof Map
      ? Object.fromEntries(r.ctc)
      : r.ctc && typeof r.ctc === "object"
        ? { ...r.ctc }
        : {};

  let hoistedInternship = NaN;
  let hoistedStipend = NaN;
  /** @type {Record<string, unknown>} */
  const nextCtc = {};

  for (const [k, v] of Object.entries(ctc)) {
    const nk = stipendNormalizedMapKey(k);
    if (nk === "internshipstipend") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) hoistedInternship = n;
      continue;
    }
    if (nk === "stipend") {
      const n = Number(String(v).trim().replace(/,/g, ""));
      if (Number.isFinite(n) && n >= 0) hoistedStipend = n;
      continue;
    }
    nextCtc[k] = v;
  }

  const topNum = Number(r.internshipStipend);
  let stip = NaN;
  if (Number.isFinite(topNum) && topNum >= 0) stip = topNum;
  else if (Number.isFinite(hoistedInternship)) stip = hoistedInternship;
  else if (Number.isFinite(hoistedStipend)) stip = hoistedStipend;

  r.ctc = nextCtc;
  if (Number.isFinite(stip)) r.internshipStipend = stip;
  else delete r.internshipStipend;

  return r;
}

/** Canonical shape before any `company_visits.roles` write (hoists stipend off `ctc`). */
function sanitizeRolesArrayForPersist(roles) {
  if (!Array.isArray(roles)) return roles;
  return roles.map((role) =>
    role && typeof role === "object" ? normalizeRoleStipendFields({ ...role }) : role
  );
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
        return normalizeRoleStipendFields(r);
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
 * Visit-level `must_do_topics` are shown cluster-wide for a company, independent
 * of visit year/type. Keep this read separate from placement-year card stats.
 * @param {import("mongoose").Types.ObjectId[]} companyIds
 * @param {{ approvedOnly?: boolean }} [opts]
 */
async function fetchMustDoTopicVisitsByCompany(companyIds, opts = {}) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const map = new Map();
  if (!companyIds.length) return map;
  const filter = {
    companyId: { $in: companyIds },
    must_do_topics: { $exists: true, $ne: [] },
  };
  if (opts.approvedOnly) filter.status = "approved";

  const visits = await CompanyVisit.find(filter)
    .select("companyId cluster must_do_topics")
    .sort({ year: 1, migratedAt: 1, _id: 1 })
    .lean();
  for (const v of visits) {
    const k = String(v.companyId);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  }
  return map;
}

/**
 * @param {Record<string, unknown>[]} visits
 * @param {unknown} clusterRaw
 * @returns {string[]}
 */
function collectMustDoTopicsForCluster(visits, clusterRaw) {
  const targetCluster = clusterKeyFromPlacementVisitClusterField(clusterRaw);
  const seen = new Set();
  const out = [];

  for (const visit of Array.isArray(visits) ? visits : []) {
    if (clusterKeyFromPlacementVisitClusterField(visit?.cluster) !== targetCluster) {
      continue;
    }
    const topics = Array.isArray(visit?.must_do_topics) ? visit.must_do_topics : [];
    for (const topic of topics) {
      if (typeof topic !== "string") continue;
      const normalized = topic.trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
    }
  }

  return out;
}

/**
 * @param {Record<string, unknown>|null|undefined} visit
 * @param {Record<string, unknown>[]} mustDoTopicVisits
 */
function withClusterMustDoTopics(visit, mustDoTopicVisits) {
  if (!visit || typeof visit !== "object") return visit;
  const topics = collectMustDoTopicsForCluster(mustDoTopicVisits, visit.cluster);
  return topics.length > 0 ? { ...visit, must_do_topics: topics } : visit;
}

/**
 * @param {unknown[]} topics
 */
function normalizeMustDoTopicArray(topics) {
  const seen = new Set();
  const out = [];
  for (const topic of Array.isArray(topics) ? topics : []) {
    if (typeof topic !== "string") continue;
    const value = topic.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Mutate the cluster-wide topic represented by the visible aggregate index.
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {unknown} clusterRaw
 * @param {number} index
 * @param {{ action: "update", topic: string } | { action: "delete" }} change
 */
export async function mutateMustDoTopicForCompanyCluster(
  companyId,
  clusterRaw,
  index,
  change
) {
  const cid = toObjectId(companyId);
  if (!cid || !Number.isInteger(index) || index < 0) {
    return { ok: false, reason: "invalid_input" };
  }

  const companyExpr = buildCompanyVisitCompanyExprMatch(cid);
  if (!companyExpr) return { ok: false, reason: "invalid_input" };

  const visits = await CompanyVisit.find({
    ...companyExpr,
    must_do_topics: { $exists: true, $ne: [] },
  })
    .select("_id companyId cluster must_do_topics year migratedAt")
    .sort({ year: 1, migratedAt: 1, _id: 1 })
    .lean();

  const targetCluster = clusterKeyFromPlacementVisitClusterField(clusterRaw);
  const clusterVisits = visits.filter(
    (visit) => clusterKeyFromPlacementVisitClusterField(visit?.cluster) === targetCluster
  );
  const visibleTopics = collectMustDoTopicsForCluster(clusterVisits, clusterRaw);
  const oldTopic = visibleTopics[index];
  if (!oldTopic) return { ok: false, reason: "topic_not_found" };

  const oldKey = oldTopic.trim().toLowerCase();
  const newTopic =
    change.action === "update" && typeof change.topic === "string"
      ? change.topic.trim()
      : "";
  if (change.action === "update" && !newTopic) {
    return { ok: false, reason: "empty_topic" };
  }

  let modifiedCount = 0;
  const nextVisibleTopics = [];

  for (const visit of clusterVisits) {
    const current = normalizeMustDoTopicArray(visit.must_do_topics);
    let changed = false;
    const next = [];

    for (const topic of current) {
      if (topic.trim().toLowerCase() === oldKey) {
        changed = true;
        if (change.action === "update") next.push(newTopic);
        continue;
      }
      next.push(topic);
    }

    if (!changed) continue;

    const normalizedNext = normalizeMustDoTopicArray(next);
    await CompanyVisit.updateOne(
      { _id: visit._id },
      { $set: { must_do_topics: normalizedNext } }
    );
    modifiedCount += 1;
  }

  if (modifiedCount > 0) {
    await invalidateCompanyDetailCache(cid);
  }

  const refreshed = await CompanyVisit.find({
    ...companyExpr,
    must_do_topics: { $exists: true, $ne: [] },
  })
    .select("companyId cluster must_do_topics year migratedAt")
    .sort({ year: 1, migratedAt: 1, _id: 1 })
    .lean();
  nextVisibleTopics.push(
    ...collectMustDoTopicsForCluster(
      refreshed.filter(
        (visit) =>
          clusterKeyFromPlacementVisitClusterField(visit?.cluster) === targetCluster
      ),
      clusterRaw
    )
  );

  return {
    ok: true,
    modifiedCount,
    topic: change.action === "update" ? newTopic : oldTopic,
    topics: nextVisibleTopics,
  };
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
 * Per placement year: branch rows from `placementGotInBranchStats` on the same visit
 * {@link pickVisitCandidateForPlacementContext} would choose for that year (mirrors GET `/companies/:id` merge).
 * @param {Record<string, unknown>[]|undefined} visits
 * @param {unknown} [placementContextRaw] — `placementContext` query (dream / open_dream / summer_internship)
 * @returns {Record<number, { branchCode: string, gotIn: number, converted: number, convertedNotApplicable: boolean }[]>}
 */
function buildPlacementBranchStatsByYearFromVisits(visits, placementContextRaw = null) {
  const ctx = normalizePlacementContextParam(placementContextRaw);
  const emptyRows = () =>
    PPO_BRANCH_CODES_ARRAY.map((branchCode) => ({
      branchCode,
      gotIn: 0,
      converted: 0,
      convertedNotApplicable: false,
    }));
  const out = Object.fromEntries(
    COMPANY_DETAIL_VISIT_YEARS.map((y) => [y, emptyRows()])
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
    const picked = pickVisitCandidateForPlacementContext(perYear, ctx);
    const rawRows = Array.isArray(picked?.placementGotInBranchStats)
      ? picked.placementGotInBranchStats
      : [];
    /** @type {Map<string, { gotIn: number, converted: number, convertedNotApplicable: boolean }>} */
    const byCode = new Map();
    for (const row of rawRows) {
      const bc = String(row?.branchCode || "")
        .trim()
        .toLowerCase();
      if (!PPO_BRANCH_CODES.has(bc)) continue;
      byCode.set(bc, {
        gotIn: Math.max(0, Number(row?.gotIn) || 0),
        converted: Math.max(0, Number(row?.converted) || 0),
        convertedNotApplicable: Boolean(row?.convertedNotApplicable),
      });
    }
    out[year] = PPO_BRANCH_CODES_ARRAY.map((branchCode) => {
      const hit = byCode.get(branchCode);
      return {
        branchCode,
        gotIn: hit?.gotIn ?? 0,
        converted: hit?.converted ?? 0,
        convertedNotApplicable: Boolean(hit?.convertedNotApplicable),
      };
    });
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
  const v = visitDoc && typeof visitDoc === "object" ? visitDoc : null;
  const aboutVal = s.about;
  const visitHasMustDoTopics =
    v && Object.prototype.hasOwnProperty.call(v, "must_do_topics");
  const canUseStaticMustDoTopicsFallback = !v;
  const must = visitHasMustDoTopics
    ? v.must_do_topics
    : canUseStaticMustDoTopicsFallback
      ? s.must_do_topics
      : undefined;

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

  if (v) {
    const skip = new Set([
      "_id",
      "companyId",
      "year",
      "migratedAt",
      "sourceCopyId",
      "must_do_topics",
    ]);
    for (const [key, val] of Object.entries(v)) {
      if (skip.has(key)) continue;
      if (STATIC_STORAGE_KEY_SET.has(key)) continue;
      if (Object.prototype.hasOwnProperty.call(LEGACY_TO_STATIC, key)) continue;
      if (Object.prototype.hasOwnProperty.call(LEGACY_TO_DYNAMIC, key)) continue;
      if (val !== undefined) {
        out[key] = val;
      }
    }
  }

  flattenRoleCtcForJson(out);
  return out;
}

/**
 * Approved placement slots for AI interviews: one slot per distinct visit `type`;
 * choosing it merges all approved rows for that company with the same normalized type (any year/cluster).
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @returns {Promise<{ slots: { visitType: string, mergePlacementByType: boolean }[] }>}
 */
export async function listInterviewVisitSlotsForCompany(companyId) {
  const cid = toObjectId(companyId);
  if (!cid) return { slots: [] };

  const companyExpr = buildCompanyVisitCompanyExprMatch(cid);
  if (!companyExpr) return { slots: [] };

  const rows = await CompanyVisit.find({
    status: "approved",
    ...companyExpr,
  })
    .select("year type cluster migratedAt")
    .sort({ year: -1, migratedAt: -1, _id: -1 })
    .lean();

  /** @type {Map<string, { visitType: string, mergePlacementByType: boolean }>} */
  const groups = new Map();
  for (const row of rows) {
    const { type } = normalizeVisitKeyParts(row.type, row.cluster);
    const key = type;
    if (!groups.has(key)) {
      groups.set(key, { visitType: type, mergePlacementByType: true });
    }
  }

  let slots = [...groups.values()].sort((a, b) =>
    (a.visitType || "").localeCompare(b.visitType || "")
  );

  if (slots.length === 0) {
    slots = [{ visitType: "", mergePlacementByType: true }];
  }

  return { slots };
}

/**
 * Static row + approved `company_visits`: either exact `(year, type, cluster)` or all rows matching `type` when `mergeVisitsByCompanyType`.
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {unknown} visitTypeRaw
 * @param {unknown} clusterRaw
 * @param {unknown} placementYearRaw
 * @param {boolean} [mergeVisitsByCompanyType]
 * @returns {Promise<{ merged: Record<string, unknown>|null, staticRow: Record<string, unknown>|null, placementYear: number, syntheticVisit: Record<string, unknown>|null, mergePlacementByType: boolean }>}
 */
export async function getInterviewMergedCompanyPayload(
  companyId,
  visitTypeRaw,
  clusterRaw,
  placementYearRaw,
  mergeVisitsByCompanyType = false
) {
  const cid = toObjectId(companyId);
  const norm = normalizeVisitKeyParts(visitTypeRaw, clusterRaw);
  const year = normalizePlacementVisitYear(placementYearRaw);
  const mergePlacementByType = Boolean(mergeVisitsByCompanyType);
  if (!cid) {
    return {
      merged: null,
      staticRow: null,
      placementYear: year,
      syntheticVisit: null,
      mergePlacementByType,
    };
  }

  const staticRow = await CompanyStatic.findById(cid).lean();
  if (!staticRow) {
    return {
      merged: null,
      staticRow: null,
      placementYear: year,
      syntheticVisit: null,
      mergePlacementByType,
    };
  }

  const companyExpr = buildCompanyVisitCompanyExprMatch(cid);
  if (!companyExpr) {
    return {
      merged: mergeToLegacyShape(staticRow, null),
      staticRow,
      placementYear: year,
      syntheticVisit: null,
      mergePlacementByType,
    };
  }

  let visits;
  if (mergePlacementByType) {
    visits = await CompanyVisit.find({
      status: "approved",
      ...companyExpr,
      $expr: {
        $eq: [{ $ifNull: ["$type", ""] }, norm.type],
      },
    })
      .sort({ year: -1, migratedAt: -1, _id: -1 })
      .lean();
  } else {
    visits = await CompanyVisit.find({
      status: "approved",
      ...companyExpr,
      $expr: {
        $and: [
          { $eq: [{ $ifNull: ["$year", COMPANY_VISIT_YEAR] }, year] },
          { $eq: [{ $ifNull: ["$type", ""] }, norm.type] },
          { $eq: [{ $ifNull: ["$cluster", ""] }, norm.cluster] },
        ],
      },
    })
      .sort({ migratedAt: -1, _id: -1 })
      .lean();
  }

  const syntheticVisit =
    visits.length > 0 ? mergeApprovedVisitsIntoSyntheticVisit(visits) : null;
  const merged = mergeToLegacyShape(staticRow, syntheticVisit);

  const anchorYear =
    mergePlacementByType && visits.length > 0
      ? normalizePlacementVisitYear(
          visits[0]?.year ?? COMPANY_VISIT_YEAR
        )
      : year;

  return {
    merged,
    staticRow,
    placementYear: anchorYear,
    syntheticVisit,
    mergePlacementByType,
  };
}

/**
 * @param {unknown[]} items
 */
function dedupeJsonPreserveOrder(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    let key;
    try {
      key = JSON.stringify(item);
    } catch {
      key = String(item);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * @param {unknown[][]} arraysNewestFirst
 */
function concatDedupeStringArrays(arraysNewestFirst) {
  const seen = new Set();
  const out = [];
  for (const arr of arraysNewestFirst) {
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      const s =
        typeof raw === "string"
          ? raw.trim()
          : String(raw ?? "")
              .trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

/**
 * Merge approved visit docs for the same company/year/type/cluster (e.g. duplicate rows — newest wins scalars, arrays merged).
 * @param {Record<string, unknown>[]} visitsSortedDesc
 */
function mergeApprovedVisitsIntoSyntheticVisit(visitsSortedDesc) {
  if (!Array.isArray(visitsSortedDesc) || visitsSortedDesc.length === 0) return null;
  const plains = visitsSortedDesc.map((v) => visitWithPlainRoleCtc(v));
  const newest = plains[0];
  const skipScalars = new Set([
    "onlineQuestions",
    "onlineQuestions_solution",
    "interviewQuestions",
    "interviewQuestions_solution",
    "interviewProcess",
    "internshipExperience",
    "mcqQuestions",
    "roles",
    "selectedCandidates",
    "ppoBranchStats",
    "type",
    "cluster",
  ]);

  /** @type {Record<string, unknown>} */
  const merged = {};
  for (const [k, val] of Object.entries(newest)) {
    if (skipScalars.has(k)) continue;
    if (val !== undefined) merged[k] = val;
  }

  const parts = normalizeVisitKeyParts(newest.type, newest.cluster);
  merged.type = parts.type;
  merged.cluster = parts.cluster;

  const collect = (field) => plains.map((p) => p[field]);

  merged.onlineQuestions = concatDedupeStringArrays(collect("onlineQuestions"));
  merged.onlineQuestions_solution = concatDedupeStringArrays(
    collect("onlineQuestions_solution")
  );
  merged.interviewQuestions = concatDedupeStringArrays(collect("interviewQuestions"));
  merged.interviewQuestions_solution = concatDedupeStringArrays(
    collect("interviewQuestions_solution")
  );
  merged.interviewProcess = concatDedupeStringArrays(collect("interviewProcess"));
  merged.internshipExperience = concatDedupeStringArrays(collect("internshipExperience"));
  merged.mcqQuestions = dedupeJsonPreserveOrder(
    plains.flatMap((p) => (Array.isArray(p.mcqQuestions) ? p.mcqQuestions : []))
  );
  merged.roles = dedupeJsonPreserveOrder(
    plains.flatMap((p) => (Array.isArray(p.roles) ? p.roles : []))
  );
  merged.selectedCandidates = dedupeJsonPreserveOrder(
    plains.flatMap((p) =>
      Array.isArray(p.selectedCandidates) ? p.selectedCandidates : []
    )
  );
  merged.ppoBranchStats = dedupeJsonPreserveOrder(
    plains.flatMap((p) =>
      Array.isArray(p.ppoBranchStats) ? p.ppoBranchStats : []
    )
  );
  merged.placementGotInBranchStats = dedupeJsonPreserveOrder(
    plains.flatMap((p) =>
      Array.isArray(p.placementGotInBranchStats) ? p.placementGotInBranchStats : []
    )
  );

  return merged;
}

/**
 * Latest visit for year (any status) — e.g. to detect pending vs no row.
 * @param {import("mongoose").Types.ObjectId} companyId
 */
export async function findAnyLatestVisitForCompanyYear(
  companyId,
  year = COMPANY_VISIT_YEAR,
  placementClusterRaw = null
) {
  const match = buildCompanyVisitCompanyYearMatch(companyId, year);
  if (!match) return null;
  const one = await CompanyVisit.find(match)
    .sort({ migratedAt: -1, _id: -1 })
    .limit(1)
    .lean();
  if (!one.length) return null;
  const clusterFilter = normalizePlacementClusterQuery(placementClusterRaw);
  if (!clusterFilter) return one[0] ?? null;
  const scoped = one.filter(
    (v) => clusterKeyFromPlacementVisitClusterField(v?.cluster) === clusterFilter
  );
  return scoped[0] ?? null;
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

  if (ctx === "off_campus") {
    const off = candidates.filter((v) => visitIsMarkedOffCampus(v));
    return off.length > 0 ? off[0] : candidates[0];
  }

  if (ctx === "internship_only") {
    const only = candidates.filter((v) => visitQualifiesInternshipOnlyHubRow(v));
    return only.length > 0 ? only[0] : candidates[0];
  }

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
 * SPC writes must not attach FTE / placement-got-in stats to the strict summer PPO slot when a dream/FTE
 * row exists for the same year (otherwise `migratedAt` order made `candidates[0]` the Internship(PPO) row).
 * @param {"placement_got_in"|"ppo_branch"} statsTarget
 */
function pickVisitCandidateForSpcAnchor(candidates, ctx, statsTarget) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  if (statsTarget === "ppo_branch") {
    if (ctx === "summer_internship") {
      return pickVisitCandidateForPlacementContext(candidates, ctx);
    }
    const ppoRows = candidates.filter((v) => visitIsPpo(v) && !visitIsMarkedOffCampus(v));
    if (ppoRows.length > 0) return ppoRows[0];
    return candidates[0];
  }

  if (
    ctx === "summer_internship" ||
    ctx === "dream" ||
    ctx === "open_dream" ||
    ctx === "off_campus" ||
    ctx === "internship_only"
  ) {
    return pickVisitCandidateForPlacementContext(candidates, ctx);
  }

  const tier = candidates.filter((v) => visitQualifiesDreamTierRow(v));
  if (tier.length > 0) return tier[0];

  const dreamHub = candidates.filter((v) => visitQualifiesDreamHubListingVisit(v));
  if (dreamHub.length > 0) return dreamHub[0];

  const fteish = candidates.filter((v) => {
    if (visitIsMarkedOffCampus(v)) return false;
    return visitTypeCompactLower(v).includes("fte");
  });
  if (fteish.length > 0) return fteish[0];

  const nonPpo = candidates.filter((v) => !visitIsPpo(v) && !visitIsMarkedOffCampus(v));
  if (nonPpo.length > 0) return nonPpo[0];

  const notStrictSummerPpo = candidates.filter((v) => !visitQualifiesSummerInternshipListingRow(v));
  if (notStrictSummerPpo.length > 0) return notStrictSummerPpo[0];

  return candidates[0];
}

/**
 * @param {import("mongoose").Types.ObjectId|string} companyId
 * @param {number} yearRaw
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function fetchApprovedVisitsForCompanyDetailYear(companyId, yearRaw) {
  const year = normalizeCompanyDetailYear(yearRaw);
  const match = buildCompanyVisitCompanyYearMatch(companyId, year);
  if (!match) return [];
  const candidatesRaw = await CompanyVisit.find({
    status: "approved",
    ...match,
  })
    .sort({ migratedAt: -1, _id: -1 })
    .lean();
  return candidatesRaw.map((v) => visitWithPlainRoleCtc(v));
}

/** SPC "Internship(PPO)" (and close spellings) — used for hub + resolver fallbacks. */
function spcOfferIsInternshipPpo(typeOfferRaw) {
  const want = normalizeType(typeOfferRaw);
  return (
    want === "internship(ppo)" ||
    want === "internshipppo" ||
    (want.includes("internship") && want.includes("ppo") && !want.includes("fte"))
  );
}

/**
 * Narrow approved visits by placement hub before matching SPC offer type.
 * @param {Record<string, unknown>[]} candidates
 * @param {ReturnType<typeof normalizePlacementContextParam>} ctx
 * @param {string} typeOfOffer
 */
function filterCandidatesByPlacementHub(candidates, ctx, typeOfOffer) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  if (!ctx) return [...candidates];

  const ppoOffer = spcOfferIsInternshipPpo(typeOfOffer);

  if (ctx === "off_campus") {
    // Internship(PPO) is anchored on on-campus PPO visits; `visitMatchesSpcTypeOfOffer` rejects off-campus rows.
    if (ppoOffer) {
      return candidates.filter((v) => visitIsPpo(v) && !visitIsMarkedOffCampus(v));
    }
    return candidates.filter((v) => visitIsMarkedOffCampus(v));
  }
  if (ctx === "internship_only") {
    // "Internship only" hub lists exclude PPO, but SPC Internship(PPO) must still resolve to the PPO visit row.
    if (ppoOffer) {
      return candidates.filter((v) => visitIsPpo(v) && !visitIsMarkedOffCampus(v));
    }
    return candidates.filter((v) => visitQualifiesInternshipOnlyHubRow(v));
  }
  if (ctx === "summer_internship") {
    return candidates.filter((v) => visitIsPpo(v) && !visitIsMarkedOffCampus(v));
  }
  if (ctx === "dream" || ctx === "open_dream") {
    if (ppoOffer) {
      // Same pool as summer_internship hub: SPC Internship(PPO) must anchor any on-campus PPO visit.
      // Listing uses {@link visitQualifiesSummerInternshipListingRow} to keep strict summer rows off Dream
      // tiles, but excluding those visits here caused false "no matching visit" when opening from Dream
      // with Internship(PPO) even though the company has an approved PPO row for that year.
      return candidates.filter((v) => visitIsPpo(v) && !visitIsMarkedOffCampus(v));
    }
    return candidates.filter((v) => !visitQualifiesSummerInternshipListingRow(v));
  }
  return [...candidates];
}

/**
 * Whether `visit.type` (and flags) matches the SPC "type of offer" string.
 * @param {Record<string, unknown>} visit
 * @param {string} typeOfOffer
 */
function visitMatchesSpcTypeOfOffer(visit, typeOfOffer) {
  const want = normalizeType(typeOfOffer);
  const got = normalizeType(visit?.type);

  if (want && got && want === got) return true;

  if (want.includes("internship") && want.includes("fte")) {
    return got.includes("internship") && got.includes("fte");
  }

  if (
    want === "internship(ppo)" ||
    want === "internshipppo" ||
    (want.includes("internship") && want.includes("ppo") && !want.includes("fte"))
  ) {
    return visitIsPpo(visit) && !visitIsMarkedOffCampus(visit) && !got.includes("fte");
  }

  if (want === "fte") {
    if (got === "fte") return true;
    if (visitIsPpo(visit) || visitIsMarkedOffCampus(visit)) return false;
    return got.includes("fte") && !got.includes("internship");
  }

  if (want.includes("onlyinternship") || (want.includes("only") && want.includes("internship"))) {
    return visitQualifiesInternshipOnlyHubRow(visit);
  }

  return false;
}

/**
 * Pick the approved `company_visits` row that matches SPC offer type and optional placement hub.
 * @returns {Promise<{ ok: true, visit: Record<string, unknown> } | { ok: false, reason: string, message?: string }>}
 */
export async function resolveApprovedVisitForSpcPlacementOffer(
  companyId,
  yearRaw,
  typeOfOfferRaw,
  placementContextRaw
) {
  const cid = toObjectId(companyId);
  if (!cid) {
    return { ok: false, reason: "invalid_company", message: "Invalid company id." };
  }
  const year = normalizeCompanyDetailYear(yearRaw);
  const typeOfOffer = String(typeOfOfferRaw ?? "").trim();
  if (!typeOfOffer) {
    return {
      ok: false,
      reason: "missing_offer",
      message: "Type of offer is required to locate the visit row.",
    };
  }

  const candidates = await fetchApprovedVisitsForCompanyDetailYear(cid, year);
  if (!candidates.length) {
    return {
      ok: false,
      reason: "no_approved_visit",
      message: "No approved visit for this company and placement year.",
    };
  }

  const ctx = normalizePlacementContextParam(placementContextRaw);
  const pool = filterCandidatesByPlacementHub(candidates, ctx, typeOfOffer);
  let matched = pool.filter((v) => visitMatchesSpcTypeOfOffer(v, typeOfOffer));

  // Hub/session mismatch (e.g. internship_only or off_campus context while submitting PPO) used to yield
  // an empty pool or rows that can never pass `visitMatchesSpcTypeOfOffer` for Internship(PPO).
  if (matched.length === 0 && spcOfferIsInternshipPpo(typeOfOffer)) {
    const rescuePool = candidates.filter((v) => visitIsPpo(v) && !visitIsMarkedOffCampus(v));
    const retry = rescuePool.filter((v) => visitMatchesSpcTypeOfOffer(v, typeOfOffer));
    if (retry.length > 0) {
      matched = retry;
    }
  }

  if (matched.length === 0) {
    return {
      ok: false,
      reason: "no_matching_visit",
      message:
        "No approved visit matches the selected offer type for this placement hub and year. Check that the visit type matches the offer (e.g. FTE vs Internship(PPO)).",
    };
  }

  return { ok: true, visit: matched[0] };
}

/**
 * @param {"placement_got_in"|"ppo_branch"} statsTarget
 */
async function findApprovedVisitForSpcWrite(companyId, yearRaw, placementContextRaw, statsTarget) {
  const candidates = await fetchApprovedVisitsForCompanyDetailYear(companyId, yearRaw);
  if (!candidates.length) return null;
  const ctx = normalizePlacementContextParam(placementContextRaw);
  return pickVisitCandidateForSpcAnchor(candidates, ctx, statsTarget);
}

/**
 * Among all visit rows for (companyId, year), any status — pick the slot that matches Dream / Summer tier,
 * mirroring {@link findApprovedVisitForCompanyDetail}. Used when approving submissions tied to a hub tier.
 */
async function findAnyLatestVisitForCompanyYearMatchingContext(
  companyId,
  yearRaw,
  placementContextRaw,
  placementClusterRaw = null
) {
  const ctx = normalizePlacementContextParam(placementContextRaw);
  const year = normalizeCompanyDetailYear(yearRaw);
  const match = buildCompanyVisitCompanyYearMatch(companyId, year);
  if (!match) return null;

  const candidatesRaw = await CompanyVisit.find(match)
    .sort({ migratedAt: -1, _id: -1 })
    .lean();

  if (!candidatesRaw.length) return null;

  const clusterFilter = normalizePlacementClusterQuery(placementClusterRaw);
  const scopedRaw =
    clusterFilter == null
      ? candidatesRaw
      : candidatesRaw.filter(
          (v) => clusterKeyFromPlacementVisitClusterField(v?.cluster) === clusterFilter
        );
  if (!scopedRaw.length) return null;
  const candidates = scopedRaw.map((v) => visitWithPlainRoleCtc(v));
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
 * Also used for SPC placement/conversion writes so visit stats update the same slot the student hub merges.
 */
export async function findApprovedVisitForCompanyDetail(
  companyId,
  yearRaw,
  placementContextRaw = null,
  companyVisitIdHint = null,
  placementClusterRaw = null
) {
  let candidates = await fetchApprovedVisitsForCompanyDetailYear(companyId, yearRaw);
  if (!candidates.length) return null;

  const clusterFilter = normalizePlacementClusterQuery(placementClusterRaw);
  if (clusterFilter) {
    const scoped = candidates.filter(
      (v) =>
        clusterKeyFromPlacementVisitClusterField(v?.cluster) === clusterFilter
    );
    // Strict cluster isolation: if a cluster is requested, never fall back to another cluster.
    if (scoped.length === 0) return null;
    candidates = scoped;
  }

  const hint = toObjectId(companyVisitIdHint);
  if (hint) {
    const exact = candidates.find((v) => String(v?._id) === String(hint));
    if (exact) return exact;
  }
  const ctx = normalizePlacementContextParam(placementContextRaw);
  return pickVisitCandidateForPlacementContext(candidates, ctx);
}

/**
 * Approved visit years for this company (subset of {@link COMPANY_DETAIL_VISIT_YEARS}).
 * @param {import("mongoose").Types.ObjectId|string} companyId
 * @returns {Promise<number[]>}
 */
export async function getApprovedPlacementYearsForCompany(
  companyId,
  placementClusterRaw = null
) {
  const cid = toObjectId(companyId);
  if (!cid) return [];
  const allowed = new Set(COMPANY_DETAIL_VISIT_YEARS);
  const rows = await CompanyVisit.find({
    companyId: cid,
    status: "approved",
  })
    .select("year cluster")
    .lean();
  const clusterFilter = normalizePlacementClusterQuery(placementClusterRaw);
  const years = (clusterFilter == null
    ? rows
    : rows.filter(
        (v) => clusterKeyFromPlacementVisitClusterField(v?.cluster) === clusterFilter
      )
  ).map((v) => Number(v?.year));
  return [...new Set(years)]
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
  placementContextRaw = null,
  companyVisitIdHint = null,
  placementClusterRaw = null
) {
  const ctx = normalizePlacementContextParam(placementContextRaw);
  const clusterFilter = normalizePlacementClusterQuery(placementClusterRaw);
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
  const mustDoTopicVisitsByCompany = await fetchMustDoTopicVisitsByCompany([_id], {
    approvedOnly: true,
  });
  const mustDoTopicVisits = mustDoTopicVisitsByCompany.get(String(_id)) ?? [];
  const scopedApprovedVisits =
    clusterFilter == null
      ? allApprovedVisits
      : allApprovedVisits.filter(
          (v) =>
            clusterKeyFromPlacementVisitClusterField(v?.cluster) === clusterFilter
        );
  const totalGotInByYear = buildTotalGotInByYearFromVisits(scopedApprovedVisits);
  const placementBranchStatsByYear = buildPlacementBranchStatsByYearFromVisits(
    scopedApprovedVisits,
    placementContextRaw
  );
  const visitApproved = await findApprovedVisitForCompanyDetail(
    _id,
    placementYear,
    placementContextRaw,
    companyVisitIdHint,
    placementClusterRaw
  );
  if (visitApproved) {
    const visitForMerge = withClusterMustDoTopics(visitApproved, mustDoTopicVisits);
    const merged = {
      ...mergeToLegacyShape(staticRow, visitForMerge),
      totalGotInByYear,
      placementBranchStatsByYear,
    };
    const visitPlain = visitWithPlainRoleCtc(visitApproved);
    const headline = getCompanyDetailHeadlineTypeFromVisits(
      scopedApprovedVisits,
      visitPlain,
      placementYear
    );
    if (headline) merged.placementDetailHeadlineType = headline;
    merged.placementDreamTierVisitMissingForYear =
      ctx === "dream" || ctx === "open_dream"
        ? !hasDreamTierVisitForYear(scopedApprovedVisits, placementYear)
        : false;
    merged.placementDreamTierVisitByYear =
      buildPlacementDreamTierVisitByYearMap(scopedApprovedVisits);
    merged.placementSummerInternshipVisitMissingForYear =
      ctx === "summer_internship"
        ? !hasSummerInternshipListingVisitForYear(scopedApprovedVisits, placementYear)
        : false;
    merged.placementSummerInternshipVisitByYear =
      buildPlacementSummerInternshipVisitByYearMap(scopedApprovedVisits);
    merged.date_of_visit = mergedDateOfVisitForApi(
      visitApproved,
      scopedApprovedVisits,
      placementYear
    );
    return { merged, visit: visitApproved, staticRow };
  }
  // No approved visit for this year: if any visit exists for that year (e.g. pending), match old API — 404
  const anyVisit = await findAnyLatestVisitForCompanyYear(
    _id,
    placementYear,
    placementClusterRaw
  );
  if (anyVisit) {
    return { merged: null, visit: null, staticRow: null };
  }
  // No visit row for this year — legacy fallback: static only
  const merged = {
    ...mergeToLegacyShape(staticRow, null),
    totalGotInByYear,
    placementBranchStatsByYear,
  };
  merged.placementDreamTierVisitMissingForYear =
    ctx === "dream" || ctx === "open_dream"
      ? !hasDreamTierVisitForYear(scopedApprovedVisits, placementYear)
      : false;
  merged.placementDreamTierVisitByYear =
    buildPlacementDreamTierVisitByYearMap(scopedApprovedVisits);
  merged.placementSummerInternshipVisitMissingForYear =
    ctx === "summer_internship"
      ? !hasSummerInternshipListingVisitForYear(scopedApprovedVisits, placementYear)
      : false;
  merged.placementSummerInternshipVisitByYear =
    buildPlacementSummerInternshipVisitByYearMap(scopedApprovedVisits);
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
  const [visitsByCompany, mustDoTopicVisitsByCompany] = await Promise.all([
    fetchApprovedVisitsForDetailYearsByCompany(companyIds),
    fetchMustDoTopicVisitsByCompany(companyIds, { approvedOnly: true }),
  ]);

  const list = [];
  const normalizedListingYear =
    placementYear != null && placementYear !== ""
      ? normalizeCompanyDetailYear(placementYear)
      : null;

  const sortVisitsForListing = (a, b) => {
    const ya = Number(a?.year) || 0;
    const yb = Number(b?.year) || 0;
    if (ya !== yb) return ya - yb;
    const ma = a?.migratedAt ? new Date(a.migratedAt).getTime() : 0;
    const mb = b?.migratedAt ? new Date(b.migratedAt).getTime() : 0;
    if (ma !== mb) return mb - ma;
    const ida = a?._id ? String(a._id) : "";
    const idb = b?._id ? String(b._id) : "";
    return ida.localeCompare(idb);
  };

  const clusterFromVisit = (visit) => {
    if (!visit || typeof visit !== "object") return "";
    const direct =
      visit?.cluster ??
      visit?.Cluster;
    if (direct != null && String(direct).trim() !== "") return direct;

    for (const [k, v] of Object.entries(visit)) {
      const key = String(k || "")
        .replace(/\s+/g, "")
        .toLowerCase();
      if (key === "cluster" && v != null && String(v).trim() !== "") {
        return v;
      }
    }
    return "";
  };

  const normalizeClusterKey = (raw) =>
    String(raw || "")
      .trim()
      .toLowerCase();

  for (const row of rows) {
    const staticRow = row.c;
    if (!staticRow) continue;
    const allVisits = visitsByCompany.get(String(row._id)) ?? [];
    const visitsForListing =
      normalizedListingYear == null
        ? [...allVisits].sort(sortVisitsForListing)
        : allVisits
            .filter((v) => (Number(v?.year) || 0) === normalizedListingYear)
            .sort(sortVisitsForListing);

    /** One list row per company per cluster (avoid duplicate company cards within same cluster). */
    const visitsByCluster = new Map();
    for (const visit of visitsForListing) {
      const clusterKey = normalizeClusterKey(clusterFromVisit(visit));
      if (!visitsByCluster.has(clusterKey)) visitsByCluster.set(clusterKey, []);
      visitsByCluster.get(clusterKey).push(visit);
    }

    for (const clusterVisits of visitsByCluster.values()) {
      const visit = [...clusterVisits].sort(sortVisitsForListing)[0];
      if (!visit) continue;

      const clusterKey = normalizeClusterKey(clusterFromVisit(visit));
      const clusterScopedVisits = allVisits.filter(
        (v) => normalizeClusterKey(clusterFromVisit(v)) === clusterKey
      );
      const scopedVisits = clusterScopedVisits.length > 0 ? clusterScopedVisits : [visit];

      const totalGotInByYear = buildTotalGotInByYearFromVisits(scopedVisits);
      const mustDoTopicVisits = mustDoTopicVisitsByCompany.get(String(row._id)) ?? [];
      const visitForMerge = withClusterMustDoTopics(visit, mustDoTopicVisits);
      const merged = mergeToLegacyShape(staticRow, visitForMerge);
      const placementAnyYearPpoOnCampus =
        companyHasAnyYearSummerPpoFromVisits(scopedVisits);
      const placementHasDreamTierVisit =
        companyHasDreamTierVisitFromVisits(scopedVisits);
      const placementDreamTierForListingYear =
        normalizedListingYear == null
          ? placementHasDreamTierVisit
          : hasDreamTierVisitForYear(scopedVisits, normalizedListingYear);
      /** Strict internship(PPO) row in 2026 or 2027. */
      const placementSummerInternshipForListingYear =
        companyHasAnyYearSummerInternshipListingFromVisits(scopedVisits);
      const placementSummerStrictVisitForListingYear =
        normalizedListingYear == null
          ? placementSummerInternshipForListingYear
          : hasSummerInternshipListingVisitForYear(scopedVisits, normalizedListingYear);
      const placementMeta = getListPlacementCategoryMetaFromVisits(
        scopedVisits,
        visitWithPlainRoleCtc(visit),
        placementYear
      );
      const {
        dreamDisplayType: placementDreamDisplayType,
        dreamDetailYear: placementDreamDetailYear,
        ...catMeta
      } = placementMeta;
      const summerPref = getSummerPlacementPrefFromVisits(scopedVisits, placementYear);
      list.push({
        ...merged,
        placementCompanyVisitId: visit?._id ? String(visit._id) : undefined,
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
    minimal.placementListClusterKey = clusterKeyFromPlacementVisitClusterField(
      primary?.cluster
    );
    out.push(minimal);
  }
  return out;
}

/**
 * Small JSON for 2026 category tiles: counts per bucket + up to 5 logo rows each.
 * @param {unknown} [placementYear]
 * @param {unknown} [clusterRaw] — optional `cs` / `ec` / `me` (same as GET /api/companies?cluster=)
 * @returns {Promise<{ counts: object, logos: object }>}
 */
export async function getCompanyCategoryPreviewLogos(placementYear = null, clusterRaw = null) {
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
  let ordered = sortCompaniesForCategoryPreview(withCategory);
  const requestedCluster = normalizePlacementClusterQuery(clusterRaw);
  if (requestedCluster != null) {
    ordered = ordered.filter((c) => c.placementListClusterKey === requestedCluster);
  }
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
  const mustDoTopicVisitsByCompany = await fetchMustDoTopicVisitsByCompany([_id]);
  const mustDoTopicVisits = mustDoTopicVisitsByCompany.get(String(_id)) ?? [];
  const visitForMerge = withClusterMustDoTopics(visit, mustDoTopicVisits);
  const merged = mergeToLegacyShape(staticRow, visitForMerge);
  return { merged, staticRow, visit: visitForMerge ?? null };
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
    const pageCompanyIds = [
      ...new Map(
        page
          .map((row) => toObjectId(row.companyIdForJoin))
          .filter(Boolean)
          .map((id) => [String(id), id])
      ).values(),
    ];
    const mustDoTopicVisitsByCompany =
      await fetchMustDoTopicVisitsByCompany(pageCompanyIds);
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
      const mustDoTopicVisits =
        mustDoTopicVisitsByCompany.get(String(row.companyIdForJoin)) ?? [];
      const visitWithTopics = withClusterMustDoTopics(
        visitForMerge,
        mustDoTopicVisits
      );
      return {
        ...mergeToLegacyShape(staticRow, visitWithTopics),
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
  const mustDoTopicVisitsByCompany = await fetchMustDoTopicVisitsByCompany(
    statics.map((s) => s._id)
  );
  const items = [];
  for (const s of statics) {
    const v = await findAnyLatestVisitForCompanyYear(
      /** @type {import("mongoose").Types.ObjectId} */ (s._id),
      year == null ? COMPANY_VISIT_YEAR : year
    );
    const mustDoTopicVisits = mustDoTopicVisitsByCompany.get(String(s._id)) ?? [];
    const visitWithTopics = withClusterMustDoTopics(v, mustDoTopicVisits);
    items.push({
      ...mergeToLegacyShape(s, visitWithTopics),
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
 * @param {Record<string, unknown>|null} [hintVisitDoc] — when set, adjust this row instead of latest for the year
 * @returns {Promise<{ _id: unknown, totalGotIn?: number } | null>}
 */
export async function adjustVisitTotalGotIn(
  companyId,
  delta,
  placementYear = COMPANY_VISIT_YEAR,
  hintVisitDoc = null
) {
  const cid = toObjectId(companyId);
  if (!cid) return null;
  const d = Number(delta);
  if (Number.isNaN(d)) return null;
  const year = normalizeCompanyDetailYear(placementYear);
  const anchor = await resolveVisitAnchorDoc(cid, placementYear, hintVisitDoc);
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

/**
 * Case-insensitive substring match on company name for SPC autocomplete.
 * @param {unknown} query
 * @param {unknown} limitRaw — capped at 20
 * @returns {Promise<{ id: string, name: string }[]>}
 */
export async function suggestCompaniesForSpc(query, limitRaw = 15) {
  const q = String(query ?? "").trim();
  if (q.length < 2) return [];
  const limit = Math.min(Math.max(Number(limitRaw) || 15, 1), 20);
  const rx = new RegExp(escapeRegexLiteral(q), "i");
  const rows = await CompanyStatic.find({ name: rx })
    .select("_id name")
    .sort({ name: 1 })
    .limit(limit)
    .lean();
  return rows.map((r) => ({ id: String(r._id), name: String(r?.name || "") }));
}

/**
 * Recompute derived PPO conversion scalars from normalized branch rows (same rules as admin PUT stats).
 * @param {{ branchCode: string, gotIn: number, converted: number, convertedNotApplicable: boolean }[]} normalized
 */
function recomputePpoConversionAggregatesFromNormalized(normalized) {
  const gotInTotal = normalized.reduce((sum, item) => sum + (item.gotIn || 0), 0);
  const gotInTotalWithKnownConversion = normalized.reduce(
    (sum, item) => sum + (item.convertedNotApplicable ? 0 : (item.gotIn || 0)),
    0
  );
  const convertedTotal = normalized.reduce(
    (sum, item) => sum + (item.convertedNotApplicable ? 0 : (item.converted || 0)),
    0
  );
  return {
    ppoConversionGotIn: gotInTotal,
    ppoConversionConverted: convertedTotal,
    ppoConversionNotApplicable: normalized.some((item) => item.convertedNotApplicable),
    ppoConversionAcceptanceRate:
      gotInTotalWithKnownConversion > 0
        ? Number(((convertedTotal / gotInTotalWithKnownConversion) * 100).toFixed(2))
        : 0,
  };
}

/**
 * Maps SPC conversion-details body (`fte` | `fte_internship`) to visit `ppoConversionType` / PlacementData.typeOfOffer labels.
 * @param {unknown} conversionType
 */
export function mapSpcConversionDetailTypeToVisitLabel(conversionType) {
  const s = String(conversionType || "").trim().toLowerCase();
  if (s === "fte_internship") return "Internship+FTE";
  if (s === "fte") return "FTE";
  return "";
}

/**
 * Maps SPC placement "type of offer" to the same `conversionType` strings used by conversion-details
 * so {@link buildSpcConversionVisitPatch} can set `ppoConversionType` on the visit consistently.
 * @param {unknown} typeOfOfferRaw
 * @returns {"fte"|"fte_internship"|""}
 */
export function mapPlacementTypeOfOfferToSpcConversionType(typeOfOfferRaw) {
  const norm = String(typeOfOfferRaw || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (norm === "fte") return "fte";
  if (norm.includes("internship") && norm.includes("fte")) return "fte_internship";
  return "";
}

/** @param {unknown} ctc */
function plainCtcFromRole(ctc) {
  if (!ctc || typeof ctc !== "object") return {};
  if (ctc instanceof Map) return Object.fromEntries(ctc);
  return { ...ctc };
}

function roleNamesMatch(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

/** Fallback role row created when SPC omits role name — removed once a concrete role is submitted. */
const SPC_SYNTHETIC_ROLE_FALLBACK = "Placement details";

/** Role titles treated as placeholders; may be rewritten when SPC sends a concrete role + compensation. */
function isSpcPlaceholderRoleName(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return false;
  if (roleNamesMatch(name, SPC_SYNTHETIC_ROLE_FALLBACK)) return true;
  return n === "tbd" || n === "tba";
}

/**
 * Upsert compensation strings into visit `roles[]` (aligned with admin roles shape: roleName + ctc map).
 * When the user supplies a concrete `roleName`, upserts that row (or rewrites the first TBD/TBA/Placement-details
 * placeholder row to that name) and drops leftover placeholder rows so compensation does not duplicate.
 * When `roleName` is omitted but compensation is present: updates **every** non–"Placement details" role with
 * the same figures; if none exist, upserts "Placement details" only.
 * For an existing role, **replaces** `ctc` with this submission's keys only (no merge with legacy visit CTC).
 * Stipend strings become top-level numeric `internshipStipend` only — never `ctc.Stipend`. Preserves prior
 * `internshipStipend` when this submit omits stipend or the stipend text does not parse as a number.
 * @param {unknown[]} existingRoles
 * @param {{ roleName?: string, ctcStr?: string, baseStr?: string, stipendStr?: string }} patch
 */
export function mergeSpcOfferIntoVisitRoles(existingRoles, patch) {
  /** @type {{ roleName: string, ctc: Record<string, unknown>, internshipStipend?: number }[]} */
  const roles = [];
  if (Array.isArray(existingRoles)) {
    for (const r of existingRoles) {
      if (!r || typeof r !== "object") continue;
      const roleName = String(r.roleName ?? r.name ?? "").trim() || "Role";
      const normalized = normalizeRoleStipendFields({
        ...r,
        roleName,
      });
      /** @type {{ roleName: string, ctc: Record<string, unknown>, internshipStipend?: number }} */
      const entry = {
        roleName: String(normalized.roleName || roleName).trim() || "Role",
        ctc:
          normalized.ctc && typeof normalized.ctc === "object"
            ? /** @type {Record<string, unknown>} */ ({ ...normalized.ctc })
            : {},
      };
      const st = Number(normalized.internshipStipend);
      if (Number.isFinite(st)) entry.internshipStipend = st;
      roles.push(entry);
    }
  }

  const ctcStr = String(patch.ctcStr ?? "").trim();
  const baseStr = String(patch.baseStr ?? "").trim();
  const stipStr = String(patch.stipendStr ?? "").trim();
  const roleTrim = String(patch.roleName ?? "").trim().slice(0, 200);
  const hasComp = Boolean(ctcStr || baseStr || stipStr);
  if (!hasComp) return roles;

  const concreteRoles = roles.filter(
    (r) => !roleNamesMatch(r.roleName, SPC_SYNTHETIC_ROLE_FALLBACK)
  );

  /** @type {Record<string, string>} */
  const nextCtcPatch = {};
  if (ctcStr) nextCtcPatch.CTC = ctcStr;
  if (baseStr) nextCtcPatch.Base = baseStr;

  const stipNum = stipStr ? stipendSubmissionStringToNumber(stipStr) : undefined;

  /** @param {{ roleName: string, ctc: Record<string, unknown>, internshipStipend?: number }} prev */
  function applyPatchToRole(prev) {
    /** @type {{ roleName: string, ctc: Record<string, string>, internshipStipend?: number }} */
    const nextEntry = {
      roleName: prev.roleName,
      ctc: { ...nextCtcPatch },
    };
    if (stipNum !== undefined) {
      nextEntry.internshipStipend = stipNum;
    } else {
      const prevStipNum = Number(prev.internshipStipend);
      if (Number.isFinite(prevStipNum)) nextEntry.internshipStipend = prevStipNum;
    }
    return nextEntry;
  }

  if (roleTrim) {
    let idx = roles.findIndex((r) => roleNamesMatch(r.roleName, roleTrim));
    if (idx >= 0) {
      roles[idx] = applyPatchToRole(roles[idx]);
    } else {
      const phIdx = roles.findIndex((r) => isSpcPlaceholderRoleName(r.roleName));
      if (phIdx >= 0) {
        const patched = applyPatchToRole(roles[phIdx]);
        patched.roleName = roleTrim;
        roles[phIdx] = patched;
      } else {
        roles.push({
          roleName: roleTrim,
          ctc: nextCtcPatch,
          ...(stipNum !== undefined ? { internshipStipend: stipNum } : {}),
        });
      }
    }
    if (!roleNamesMatch(roleTrim, SPC_SYNTHETIC_ROLE_FALLBACK)) {
      return roles.filter(
        (row) =>
          roleNamesMatch(row.roleName, roleTrim) || !isSpcPlaceholderRoleName(row.roleName)
      );
    }
    return roles;
  }

  if (concreteRoles.length > 0) {
    return roles
      .filter((r) => !roleNamesMatch(r.roleName, SPC_SYNTHETIC_ROLE_FALLBACK))
      .map((prev) => applyPatchToRole(prev));
  }

  const idxPd = roles.findIndex((r) => roleNamesMatch(r.roleName, SPC_SYNTHETIC_ROLE_FALLBACK));
  if (idxPd >= 0) {
    roles[idxPd] = applyPatchToRole(roles[idxPd]);
    return roles;
  }
  roles.push({
    roleName: SPC_SYNTHETIC_ROLE_FALLBACK,
    ctc: nextCtcPatch,
    ...(stipNum !== undefined ? { internshipStipend: stipNum } : {}),
  });
  return roles;
}

/**
 * Build dynamic visit patch from SPC conversion-details body (conversion type + optional role/compensation).
 * @param {unknown[]} existingMergedRoles — merged.roles from anchored visit
 * @param {{ conversionType?: unknown, role?: unknown, ctc?: unknown, base?: unknown, stipend?: unknown }} fields
 */
export function buildSpcConversionVisitPatch(existingMergedRoles, fields) {
  /** @type {Record<string, unknown>} */
  const patch = {};
  const label = mapSpcConversionDetailTypeToVisitLabel(fields?.conversionType);
  if (label) patch.ppoConversionType = label.slice(0, 200);

  const ctcStr = String(fields?.ctc ?? "").trim();
  const baseStr = String(fields?.base ?? "").trim();
  const stipStr = String(fields?.stipend ?? "").trim();
  const roleTrim = String(fields?.role ?? "").trim();
  const hasComp = Boolean(ctcStr || baseStr || stipStr);

  if (hasComp) {
    patch.roles = mergeSpcOfferIntoVisitRoles(existingMergedRoles || [], {
      roleName: roleTrim,
      ctcStr,
      baseStr,
      stipendStr: stipStr,
    });
  }
  return patch;
}

/**
 * Apply SPC conversion-details extras (`ppoConversionType`, optional `roles` merge) on anchored visit.
 */
export async function syncAnchoredVisitSpcConversionFields(
  companyId,
  placementYear,
  fields,
  placementListContextRaw = null,
  options = {}
) {
  const cid = toObjectId(companyId);
  if (!cid) return { ok: false, reason: "invalid_company" };
  const year = normalizeCompanyDetailYear(placementYear);
  const visitHint =
    options?.resolvedVisit && options.resolvedVisit._id
      ? /** @type {Record<string, unknown>} */ (options.resolvedVisit)
      : await findApprovedVisitForSpcWrite(cid, year, placementListContextRaw, "placement_got_in");
  const staticRow = await CompanyStatic.findById(cid).lean();
  if (!visitHint?._id || !staticRow) return { ok: false, reason: "visit_not_found" };
  const merged = mergeToLegacyShape(staticRow, visitHint);

  const patch = buildSpcConversionVisitPatch(merged.roles || [], fields || {});
  if (Object.keys(patch).length === 0) return { ok: true };

  await updateCompanyVisit(cid, patch, year, visitHint);
  return { ok: true };
}

/**
 * Adjust `ppoBranchStats[]` on the anchored visit: optional `gotInDelta`, optional `convertedDelta` (either may be 0).
 * Does not modify `totalGotIn`.
 * When `convertedDelta > 0`, clears `convertedNotApplicable` for that branch so aggregates count conversions (admin formulas skip converted when NA is true).
 * Optional `options.spcConversion` merges `ppoConversionType` and optional `roles` (CTC/Base/Stipend) on the same write.
 * Optional `options.placementListContext` / `options.placementContext` — same hub hint as GET `/companies/:id?placementContext=`.
 * @param {number} [gotInDelta]
 * @param {number} [convertedDelta]
 * @param {{ spcConversion?: { conversionType?: unknown, role?: unknown, ctc?: unknown, base?: unknown, stipend?: unknown }, placementListContext?: unknown, placementContext?: unknown, resolvedVisit?: Record<string, unknown>|null }} [options]
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function incrementPpoBranchGotInForAnchoredVisit(
  companyId,
  placementYear,
  branchCode,
  gotInDelta = 1,
  convertedDelta = 0,
  options = {}
) {
  const code = String(branchCode || "").trim().toLowerCase();
  if (!PPO_BRANCH_CODES.has(code)) {
    return { ok: false, reason: "invalid_branch" };
  }
  const cid = toObjectId(companyId);
  if (!cid) {
    return { ok: false, reason: "invalid_company" };
  }
  const year = normalizeCompanyDetailYear(placementYear);
  const d = Number(gotInDelta);
  const cd = Number(convertedDelta);
  const dOk = Number.isFinite(d) && d !== 0;
  const cdOk = Number.isFinite(cd) && cd !== 0;
  if (!dOk && !cdOk) {
    return { ok: false, reason: "invalid_delta" };
  }

  const listCtx =
    options?.placementListContext != null && String(options.placementListContext).trim() !== ""
      ? options.placementListContext
      : options?.placementContext != null && String(options.placementContext).trim() !== ""
        ? options.placementContext
        : null;
  const visitHint =
    options?.resolvedVisit && options.resolvedVisit._id
      ? /** @type {Record<string, unknown>} */ (options.resolvedVisit)
      : await findApprovedVisitForSpcWrite(cid, year, listCtx, "ppo_branch");
  const staticRow = await CompanyStatic.findById(cid).lean();
  if (!visitHint?._id || !staticRow) {
    return { ok: false, reason: "visit_not_found" };
  }
  const merged = mergeToLegacyShape(staticRow, visitHint);

  const rawRows = Array.isArray(merged.ppoBranchStats) ? merged.ppoBranchStats : [];
  /** @type {Map<string, { branchCode: string, gotIn: number, converted: number, convertedNotApplicable: boolean }>} */
  const byCode = new Map();
  for (const row of rawRows) {
    const bc = String(row?.branchCode || "").trim().toLowerCase();
    if (!PPO_BRANCH_CODES.has(bc)) continue;
    const gotIn = Math.max(0, Number.parseInt(String(row?.gotIn ?? 0), 10)) || 0;
    const converted = Math.max(0, Number.parseInt(String(row?.converted ?? 0), 10)) || 0;
    const convertedNotApplicable = Boolean(row?.convertedNotApplicable);
    byCode.set(bc, { branchCode: bc, gotIn, converted, convertedNotApplicable });
  }

  const cur = byCode.get(code) || {
    branchCode: code,
    gotIn: 0,
    converted: 0,
    convertedNotApplicable: false,
  };
  if (dOk) {
    cur.gotIn = Math.max(0, Math.max(0, cur.gotIn) + d);
  }
  if (cdOk) {
    cur.converted = Math.max(0, Math.max(0, cur.converted) + cd);
    if (cd > 0) {
      cur.convertedNotApplicable = false;
    }
  }
  byCode.set(code, cur);

  const normalized = PPO_BRANCH_CODES_ARRAY.filter((bc) => byCode.has(bc)).map((bc) => byCode.get(bc));
  const aggregates = recomputePpoConversionAggregatesFromNormalized(normalized);

  /** @type {Record<string, unknown>} */
  const payload = {
    ppoBranchStats: normalized,
    ...aggregates,
  };
  const spc = options?.spcConversion;
  if (spc && typeof spc === "object") {
    const visitPatch = buildSpcConversionVisitPatch(merged.roles || [], spc);
    if (visitPatch.ppoConversionType) payload.ppoConversionType = visitPatch.ppoConversionType;
    if (visitPatch.roles) payload.roles = visitPatch.roles;
  }

  await updateCompanyVisit(cid, payload, year, visitHint);

  return { ok: true };
}

/**
 * Single visit write for SPC "conversion-details" first-time save: bumps
 * {@link placementGotInBranchStats} + `totalGotIn`, increments `ppoBranchStats[].converted` for the branch
 * (and PPO aggregates), and sets `ppoConversionType` / `roles` from the form (`visitSyncFields`).
 * Avoids two separate writes getting out of sync if one fails.
 */
export async function incrementPlacementAndPpoConvertedForSpcConversionDetails(
  companyId,
  placementYear,
  branchCode,
  placementGotInDelta = 1,
  ppoConvertedDelta = 1,
  visitSyncFields,
  placementListContextRaw = null,
  options = {}
) {
  const code = String(branchCode || "").trim().toLowerCase();
  if (!PPO_BRANCH_CODES.has(code)) {
    return { ok: false, reason: "invalid_branch" };
  }
  const cid = toObjectId(companyId);
  if (!cid) {
    return { ok: false, reason: "invalid_company" };
  }
  const year = normalizeCompanyDetailYear(placementYear);
  const dPl = Number(placementGotInDelta);
  const dConv = Number(ppoConvertedDelta);
  if (!Number.isFinite(dPl) || dPl <= 0) {
    return { ok: false, reason: "invalid_placement_delta" };
  }
  if (!Number.isFinite(dConv) || dConv <= 0) {
    return { ok: false, reason: "invalid_ppo_converted_delta" };
  }

  const listCtx =
    options?.placementListContext != null && String(options.placementListContext).trim() !== ""
      ? options.placementListContext
      : options?.placementContext != null && String(options.placementContext).trim() !== ""
        ? options.placementContext
        : null;
  const visitHint =
    options?.resolvedVisit && options.resolvedVisit._id
      ? /** @type {Record<string, unknown>} */ (options.resolvedVisit)
      : await findApprovedVisitForSpcWrite(cid, year, placementListContextRaw, "placement_got_in");
  const staticRow = await CompanyStatic.findById(cid).lean();
  if (!visitHint?._id || !staticRow) {
    return { ok: false, reason: "visit_not_found" };
  }
  const merged = mergeToLegacyShape(staticRow, visitHint);

  const rawPlacement = Array.isArray(merged.placementGotInBranchStats)
    ? merged.placementGotInBranchStats
    : [];
  /** @type {Map<string, { branchCode: string, gotIn: number }>} */
  const placeByCode = new Map();
  for (const row of rawPlacement) {
    const bc = String(row?.branchCode || "").trim().toLowerCase();
    if (!PPO_BRANCH_CODES.has(bc)) continue;
    const gotIn = Math.max(0, Number.parseInt(String(row?.gotIn ?? 0), 10)) || 0;
    placeByCode.set(bc, { branchCode: bc, gotIn });
  }
  const curPl = placeByCode.get(code) || { branchCode: code, gotIn: 0 };
  curPl.gotIn = Math.max(0, curPl.gotIn) + dPl;
  placeByCode.set(code, curPl);
  const normalizedPlacement = PPO_BRANCH_CODES_ARRAY.map((bc) =>
    placeByCode.has(bc) ? placeByCode.get(bc) : { branchCode: bc, gotIn: 0 }
  );
  const currentTotal = Math.max(0, Number.parseInt(String(merged.totalGotIn ?? 0), 10)) || 0;

  const rawPpo = Array.isArray(merged.ppoBranchStats) ? merged.ppoBranchStats : [];
  /** @type {Map<string, { branchCode: string, gotIn: number, converted: number, convertedNotApplicable: boolean }>} */
  const ppoByCode = new Map();
  for (const row of rawPpo) {
    const bc = String(row?.branchCode || "").trim().toLowerCase();
    if (!PPO_BRANCH_CODES.has(bc)) continue;
    const gotIn = Math.max(0, Number.parseInt(String(row?.gotIn ?? 0), 10)) || 0;
    const converted = Math.max(0, Number.parseInt(String(row?.converted ?? 0), 10)) || 0;
    const convertedNotApplicable = Boolean(row?.convertedNotApplicable);
    ppoByCode.set(bc, { branchCode: bc, gotIn, converted, convertedNotApplicable });
  }
  const curPpo = ppoByCode.get(code) || {
    branchCode: code,
    gotIn: 0,
    converted: 0,
    convertedNotApplicable: false,
  };
  curPpo.converted = Math.max(0, curPpo.converted) + dConv;
  curPpo.convertedNotApplicable = false;
  ppoByCode.set(code, curPpo);
  const normalizedPpo = PPO_BRANCH_CODES_ARRAY.filter((bc) => ppoByCode.has(bc)).map((bc) =>
    ppoByCode.get(bc)
  );
  const aggregates = recomputePpoConversionAggregatesFromNormalized(normalizedPpo);

  const visitPatch = buildSpcConversionVisitPatch(merged.roles || [], visitSyncFields || {});

  /** @type {Record<string, unknown>} */
  const payload = {
    placementGotInBranchStats: normalizedPlacement,
    totalGotIn: currentTotal + dPl,
    ppoBranchStats: normalizedPpo,
    ...aggregates,
  };
  if (visitPatch.ppoConversionType) payload.ppoConversionType = visitPatch.ppoConversionType;
  if (visitPatch.roles) payload.roles = visitPatch.roles;

  await updateCompanyVisit(cid, payload, year, visitHint);
  return { ok: true };
}

/**
 * Increment `placementGotInBranchStats[].gotIn` and `totalGotIn` on the anchored visit
 * (Dream / open-dream / off-campus / internship-only placement counts — not ppoBranchStats.)
 * @param {number} [gotInDelta]
 * @param {unknown} [placementListContextRaw] — same as GET `/companies/:id?placementContext=` when multiple approved visits share a year.
 * @param {{ resolvedVisit?: Record<string, unknown>|null }} [options] — when set, stats are written to this visit (from {@link resolveApprovedVisitForSpcPlacementOffer}).
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function incrementPlacementGotInBranchForAnchoredVisit(
  companyId,
  placementYear,
  branchCode,
  gotInDelta = 1,
  placementListContextRaw = null,
  options = {}
) {
  const code = String(branchCode || "").trim().toLowerCase();
  if (!PPO_BRANCH_CODES.has(code)) {
    return { ok: false, reason: "invalid_branch" };
  }
  const cid = toObjectId(companyId);
  if (!cid) {
    return { ok: false, reason: "invalid_company" };
  }
  const year = normalizeCompanyDetailYear(placementYear);
  const d = Number(gotInDelta);
  if (!Number.isFinite(d) || d === 0) {
    return { ok: false, reason: "invalid_delta" };
  }

  const visitHint =
    options?.resolvedVisit && options.resolvedVisit._id
      ? /** @type {Record<string, unknown>} */ (options.resolvedVisit)
      : await findApprovedVisitForSpcWrite(cid, year, placementListContextRaw, "placement_got_in");
  const staticRow = await CompanyStatic.findById(cid).lean();
  if (!visitHint?._id || !staticRow) {
    return { ok: false, reason: "visit_not_found" };
  }
  const merged = mergeToLegacyShape(staticRow, visitHint);

  const rawRows = Array.isArray(merged.placementGotInBranchStats)
    ? merged.placementGotInBranchStats
    : [];
  /** @type {Map<string, { branchCode: string, gotIn: number }>} */
  const byCode = new Map();
  for (const row of rawRows) {
    const bc = String(row?.branchCode || "").trim().toLowerCase();
    if (!PPO_BRANCH_CODES.has(bc)) continue;
    const gotIn = Math.max(0, Number.parseInt(String(row?.gotIn ?? 0), 10)) || 0;
    byCode.set(bc, { branchCode: bc, gotIn });
  }

  const cur = byCode.get(code) || { branchCode: code, gotIn: 0 };
  cur.gotIn = Math.max(0, Math.max(0, cur.gotIn) + d);
  byCode.set(code, cur);

  const normalized = PPO_BRANCH_CODES_ARRAY.map((bc) =>
    byCode.has(bc) ? byCode.get(bc) : { branchCode: bc, gotIn: 0 }
  );

  const currentTotal = Math.max(0, Number.parseInt(String(merged.totalGotIn ?? 0), 10)) || 0;
  const nextTotal = Math.max(0, currentTotal + d);

  await updateCompanyVisit(
    cid,
    {
      placementGotInBranchStats: normalized,
      totalGotIn: nextTotal,
    },
    year,
    visitHint
  );

  return { ok: true };
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
    if (Object.prototype.hasOwnProperty.call(LEGACY_TO_DYNAMIC, k)) {
      const target = LEGACY_TO_DYNAMIC[/** @type {keyof typeof LEGACY_TO_DYNAMIC} */ (k)];
      if (dynamicDoc[target] === undefined) {
        dynamicDoc[target] = v;
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
    if (Object.prototype.hasOwnProperty.call(LEGACY_TO_DYNAMIC, k)) {
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
  for (const [legacyKey, dynamicKey] of Object.entries(LEGACY_TO_DYNAMIC)) {
    if (Object.prototype.hasOwnProperty.call(data, legacyKey)) {
      out[dynamicKey] = data[legacyKey];
    }
  }
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
  if (visitDoc.roles !== undefined) {
    visitDoc.roles = sanitizeRolesArrayForPersist(visitDoc.roles);
  }

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
  if ($set.roles !== undefined) {
    $set.roles = sanitizeRolesArrayForPersist($set.roles);
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
    roles: sanitizeRolesArrayForPersist(Array.isArray(existing.roles) ? existing.roles : []),
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
