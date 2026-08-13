/**
 * Read-through cache for GET /api/placement/spc/my-submissions (per SPC login email + cluster).
 * Invalidated when this SPC adds, edits, or deletes placement/conversion rows or company contributions.
 */
import Submission from "../models/Submission.js";
import PlacementData from "../models/PlacementData.js";
import CompanyVisit from "../models/CompanyVisit.js";
import { redisUrl } from "../src/utils/redisClient.js";
import { getJSON, setJSON, deleteKey } from "../src/utils/redisHelpers.js";
import { normalizeSubmitterEmail } from "./mySubmissionsCache.js";
import {
  clusterKeyFromPlacementVisitClusterField,
  normalizePlacementClusterQuery,
  placementHubClusterFromPpoBranchCode,
} from "../utils/placementCluster.js";

const KEY_PREFIX = "rv:spc:my_records:v2:";
const TTL_SECONDS = 900;

function redisKeyForEmail(email, clusterRaw = "") {
  const e = normalizeSubmitterEmail(email);
  if (!e) return null;
  const cluster = normalizePlacementClusterQuery(clusterRaw) || "none";
  return `${KEY_PREFIX}${e}:${cluster}`;
}

/** Escape string for use inside a RegExp source (email-safe). */
function escapeRegexForEmail(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Same payload shape as GET /api/placement/spc/my-submissions.
 * When `spcClusterRaw` is set, only visit-cluster / program-hub matches are returned.
 * @param {string} email
 * @param {string} userId
 * @param {unknown} [spcClusterRaw]
 */
export async function loadSpcMyRecordsFromDb(email, userId, spcClusterRaw = null) {
  const emailNorm = normalizeSubmitterEmail(email);
  const userIdTrim = String(userId || "").trim();
  const spcHub = normalizePlacementClusterQuery(spcClusterRaw);

  const contributionFilter = emailNorm
    ? {
        "submittedBy.email": {
          $regex: new RegExp(`^${escapeRegexForEmail(emailNorm)}$`, "i"),
        },
      }
    : { _id: null };

  const createdByOr = [];
  if (userIdTrim) createdByOr.push({ createdBy: userIdTrim });
  if (emailNorm) {
    createdByOr.push({ createdBy: emailNorm });
    createdByOr.push({
      createdBy: { $regex: new RegExp(`^${escapeRegexForEmail(emailNorm)}$`, "i") },
    });
  }
  const placementFilter = createdByOr.length > 0 ? { $or: createdByOr } : { _id: null };

  const [contributionsRaw, placementRaw] = await Promise.all([
    Submission.find(contributionFilter)
      .sort({ submittedAt: -1, _id: -1 })
      .populate("companyId", "name")
      .limit(200)
      .lean(),
    PlacementData.find(placementFilter)
      .sort({ updatedAt: -1 })
      .populate("companyId", "name")
      .populate("studentId", "name email usn")
      .limit(200)
      .lean(),
  ]);

  let allowedVisitIds = null;
  if (spcHub) {
    const visitIds = [
      ...new Set(
        contributionsRaw
          .map((s) => (s.companyVisitId ? String(s.companyVisitId) : ""))
          .filter(Boolean)
      ),
    ];
    if (visitIds.length > 0) {
      const visits = await CompanyVisit.find({ _id: { $in: visitIds } })
        .select("_id cluster")
        .lean();
      allowedVisitIds = new Set(
        visits
          .filter((v) => clusterKeyFromPlacementVisitClusterField(v?.cluster) === spcHub)
          .map((v) => String(v._id))
      );
    } else {
      allowedVisitIds = new Set();
    }
  }

  const contributions = contributionsRaw
    .filter((s) => {
      if (!spcHub) return true;
      const visitId = s.companyVisitId ? String(s.companyVisitId) : "";
      if (!visitId) return false;
      return allowedVisitIds.has(visitId);
    })
    .map((s) => ({
      _id: String(s._id),
      kind: "company_contribution",
      type: s.type,
      status: s.status,
      submittedAt: s.submittedAt,
      placementYear: s.placementYear ?? null,
      placementListContext: s.placementListContext ?? null,
      companyId: s.companyId?._id ? String(s.companyId._id) : null,
      companyName: s.companyId?.name || "Unknown company",
      contentPreview: String(s.content || "").slice(0, 200),
    }));

  const placements = placementRaw
    .filter((p) => {
      if (!spcHub) return true;
      return placementHubClusterFromPpoBranchCode(p.branchCode) === spcHub;
    })
    .map((p) => ({
      _id: String(p._id),
      kind: "placement_record",
      companyPlaced: p.companyPlaced,
      companyId: p.companyId?._id ? String(p.companyId._id) : null,
      companyName: p.companyId?.name || p.companyPlaced || "—",
      placementYear: p.placementYear ?? null,
      branchCode: p.branchCode || "",
      typeOfOffer: p.typeOfOffer || "",
      ppoConversionType: p.ppoConversionType || "",
      role: p.role || "",
      stipend: p.stipend || "",
      sixMonthsInternshipStipend: p["6-months-internship-stipend"] || "",
      base: p.base || "",
      ctc: p.ctc || "",
      studentName: p.studentId?.name || "—",
      studentEmail: p.studentId?.email || "",
      studentUsn: p.studentId?.usn || "",
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      createdBy: p.createdBy || "",
    }));

  return { contributions, placements };
}

const CLUSTER_CACHE_SUFFIXES = ["none", "cs", "ec", "me", "chem"];

/**
 * @param {string} email
 * @param {unknown} [clusterRaw]
 * @returns {Promise<{ contributions: object[], placements: object[] } | null>}
 */
export async function getCachedSpcMyRecords(email, clusterRaw = "") {
  if (!redisUrl) return null;
  const key = redisKeyForEmail(email, clusterRaw);
  if (!key) return null;
  const raw = await getJSON(key);
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.contributions) || !Array.isArray(raw.placements)) return null;
  return { contributions: raw.contributions, placements: raw.placements };
}

/**
 * @param {string} email
 * @param {{ contributions: object[], placements: object[] }} payload
 * @param {unknown} [clusterRaw]
 */
export async function setCachedSpcMyRecords(email, payload, clusterRaw = "") {
  if (!redisUrl) return;
  const key = redisKeyForEmail(email, clusterRaw);
  if (!key) return;
  const contributions = Array.isArray(payload?.contributions) ? payload.contributions : [];
  const placements = Array.isArray(payload?.placements) ? payload.placements : [];
  await setJSON(key, { contributions, placements }, TTL_SECONDS);
}

/**
 * @param {string} email
 */
export async function invalidateSpcMyRecordsCacheByEmail(email) {
  if (!redisUrl) {
    return { deleted: 0, skippedNoRedis: true };
  }
  let deleted = 0;
  for (const suffix of CLUSTER_CACHE_SUFFIXES) {
    const key = redisKeyForEmail(email, suffix === "none" ? "" : suffix);
    if (!key) continue;
    const ok = await deleteKey(key);
    if (ok) deleted += 1;
  }
  return { deleted };
}

