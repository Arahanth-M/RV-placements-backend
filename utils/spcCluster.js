import User1 from "../models/User1.js";
import {
  isHubClusterAllowedForCollege,
  normalizePlacementClusterQuery,
  placementHubClusterFromPpoBranchCode,
} from "./placementCluster.js";

/** `{name}.{cs22}@…` or `{cs22}.{name}@…` style local-part tokens. */
const BRANCH_YEAR_TOKEN = /^([a-z]{2,4})(\d{2})$/i;
/** USN like `1RV22CS001`. */
const USN_BRANCH = /^\d[A-Z]{2}\d{2}([A-Z]{2})\d+$/i;

/**
 * Infer placement hub from a college email local-part (read-only; does not write).
 * Example: `arahanthm.cs22@rvce.edu.in` → `cs`.
 * @param {unknown} email
 * @returns {string|null}
 */
export function placementHubClusterFromEmail(email) {
  const local = String(email || "")
    .trim()
    .toLowerCase()
    .split("@")[0];
  if (!local) return null;
  const parts = local.split(".").filter(Boolean);
  for (const part of parts) {
    const m = part.match(BRANCH_YEAR_TOKEN);
    if (!m) continue;
    const hub = placementHubClusterFromPpoBranchCode(m[1]);
    if (hub) return hub;
  }
  return null;
}

/**
 * Infer placement hub from a USN (read-only).
 * Example: `1RV22CS001` → `cs`.
 * @param {unknown} usn
 * @returns {string|null}
 */
export function placementHubClusterFromUsn(usn) {
  const u = String(usn || "").trim().toUpperCase();
  const m = u.match(USN_BRANCH);
  if (!m) return null;
  return placementHubClusterFromPpoBranchCode(m[1]);
}

/**
 * Prefer email, then USN. Does not write to the database.
 * @param {unknown} email
 * @param {unknown} usn
 * @returns {string|null}
 */
export function inferSpcClusterFromEmailAndUsn(email, usn) {
  return placementHubClusterFromEmail(email) || placementHubClusterFromUsn(usn);
}

/**
 * True when the actor is an SPC (not an admin dashboard session).
 * @param {{ isAdminSession?: unknown, role?: unknown }|null|undefined} user
 * @returns {boolean}
 */
export function isSpcActor(user) {
  return user?.isAdminSession !== true && String(user?.role || "").toLowerCase() === "spc";
}

/**
 * Load assigned hub from User1. Existing rows without `spcCluster` stay unchanged and return null.
 * @param {{ _id?: unknown, role?: unknown, isAdminSession?: unknown }|null|undefined} user
 * @returns {Promise<string|null>}
 */
export async function getAssignedSpcCluster(user) {
  if (!isSpcActor(user) || !user?._id) return null;
  const doc = await User1.findById(user._id).select("role spcCluster").lean();
  if (!doc || String(doc.role || "").toLowerCase() !== "spc") return null;
  return normalizePlacementClusterQuery(doc.spcCluster);
}

/**
 * @param {unknown} clusterRaw
 * @param {unknown} collegeIdRaw
 * @returns {string|null}
 */
export function normalizeAssignedSpcCluster(clusterRaw, collegeIdRaw) {
  const key = normalizePlacementClusterQuery(clusterRaw);
  if (!key) return null;
  if (!isHubClusterAllowedForCollege(key, collegeIdRaw)) return null;
  return key;
}

export const SPC_CLUSTER_NOT_ASSIGNED_MESSAGE =
  "Your SPC cluster is not assigned. Ask an admin to assign a cluster.";

export const SPC_CLUSTER_SUBMISSION_FORBIDDEN_MESSAGE =
  "This submission is outside your assigned cluster.";

export const SPC_CLUSTER_MISSING_VISIT_MESSAGE =
  "This submission has no visit cluster and can only be reviewed by an admin.";

export const SPC_CLUSTER_WRITE_FORBIDDEN_MESSAGE =
  "You can only add data for your assigned cluster.";
