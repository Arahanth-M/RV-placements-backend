import { COLLEGE_ID_RVITM, normalizeCollegeId } from "./collegeScope.js";

/** Hub keys used for `?cluster=` filters and per-cluster placement settings. */
export const PLACEMENT_HUB_CLUSTER_KEYS = Object.freeze(["cs", "ec", "me", "chem"]);

/** RVITM only offers CS / EC programme hubs. */
export const PLACEMENT_HUB_CLUSTER_KEYS_RVITM = Object.freeze(["cs", "ec"]);

export const PLACEMENT_HUB_CLUSTER_LABELS = Object.freeze({
  cs: "Computer Science & Engineering",
  ec: "Electronics & Communication",
  me: "Mechanical Engineering",
  chem: "Chemical Sciences (CH / Civil / BT)",
});

/** Canonical `company_visits.cluster` strings used when creating/matching visit rows. */
export const PLACEMENT_HUB_CLUSTER_DB_LABELS = Object.freeze({
  cs: "Computer Science and Engineering",
  ec: "Electronics and Communication",
  me: "Mechanical Engineering",
  chem: "Chemical Engineering",
});

/**
 * Placement hub cluster: query params and visit `company_visits.cluster` routing.
 *
 * **DB reality (`company_visits.cluster`):** values are often full programme names, not short codes.
 * Example: CS rows use `"Computer Science and Engineering"` (not `"cs"`). EC/ME similarly use long
 * department strings. Chemical sciences hub key is `chem` (CH, Civil, BT — keyword match on visit text).
 * Normalization below uses keyword heuristics so listing, detail `placementCluster`,
 * and hub filters stay consistent. **Empty `cluster` still defaults to CS** (legacy rows); real EC/ME
 * visits should set `cluster` explicitly or they can be misclassified as CS.
 */

/**
 * Map stored visit.cluster → hub key. Handles short codes and full names, e.g.
 * `"Computer Science and Engineering"` → `"cs"`.
 *
 * @param {unknown} raw — visit.cluster on company_visits
 * @returns {string}
 */
export function clusterKeyFromPlacementVisitClusterField(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "cs";
  // Short codes + full department strings (see module note).
  if (
    v === "cs" ||
    v === "cse" ||
    v.includes("computer science") ||
    v.includes("information science")
  ) {
    return "cs";
  }
  if (
    v === "ec" ||
    v === "ece" ||
    v.includes("electronics") ||
    v.includes("electrical")
  ) {
    return "ec";
  }
  if (v === "me" || v.includes("mechanical")) return "me";
  if (v === "chem" || v === "ch" || v === "bt") return "chem";
  if (
    v.includes("chemical") ||
    v.includes("civil") ||
    v.includes("biotech") ||
    v.includes("bio tech")
  ) {
    return "chem";
  }
  return v;
}

/**
 * @param {unknown} raw — e.g. `req.query.cluster` or `req.query.placementCluster`
 * @returns {string|null} hub key `cs|ec|me|chem`, or null when unset
 */
export function normalizePlacementClusterQuery(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  // Accept short codes and full programme names from admin forms
  // (e.g. "Computer Science and Engineering" → "cs").
  const key = clusterKeyFromPlacementVisitClusterField(v);
  if (key === "cs" || key === "ec" || key === "me" || key === "chem") return key;
  return null;
}

/**
 * @param {unknown} hubKey
 * @returns {string} canonical DB cluster label
 */
export function canonicalVisitClusterLabel(hubKey) {
  const key = normalizePlacementClusterQuery(hubKey) || "cs";
  return PLACEMENT_HUB_CLUSTER_DB_LABELS[key] || PLACEMENT_HUB_CLUSTER_DB_LABELS.cs;
}

/**
 * Mongo `$match` fragment for hub cluster filtering on `company_visits.cluster`.
 * Mirrors {@link clusterKeyFromPlacementVisitClusterField} heuristics (incl. empty → cs).
 * Read-only query filter — does not alter stored data.
 *
 * @param {unknown} hubKeyRaw — cs|ec|me|chem
 * @returns {Record<string, unknown>|null}
 */
export function mongoMatchForPlacementHubCluster(hubKeyRaw) {
  const key = normalizePlacementClusterQuery(hubKeyRaw);
  if (!key) return null;

  if (key === "cs") {
    return {
      $or: [
        { cluster: { $exists: false } },
        { cluster: null },
        { cluster: "" },
        {
          cluster: {
            $regex: "(^|\\s)(cs|cse)(\\s|$)|computer\\s*science|information\\s*science",
            $options: "i",
          },
        },
      ],
    };
  }
  if (key === "ec") {
    return {
      cluster: {
        $regex: "(^|\\s)(ec|ece)(\\s|$)|electronics|electrical",
        $options: "i",
      },
    };
  }
  if (key === "me") {
    return {
      cluster: {
        $regex: "(^|\\s)me(\\s|$)|mechanical",
        $options: "i",
      },
    };
  }
  if (key === "chem") {
    return {
      cluster: {
        $regex:
          "(^|\\s)(chem|ch|bt)(\\s|$)|chemical|civil|biotech|bio\\s*tech",
        $options: "i",
      },
    };
  }
  return null;
}

/**
 * Map SPC / PPO student program code → placement hub key (cs | ec | me | chem).
 * @param {unknown} branchCodeRaw
 * @returns {string|null}
 */
export function placementHubClusterFromPpoBranchCode(branchCodeRaw) {
  const bc = String(branchCodeRaw ?? "")
    .trim()
    .toLowerCase();
  if (!bc) return null;
  if (["cd", "cy", "cs", "is", "ai", "ise", "cse", "aiml"].includes(bc)) return "cs";
  if (["ec", "et", "ei", "ee", "ece", "ete", "eie", "eee"].includes(bc)) return "ec";
  if (["as", "im", "me", "ase", "iem"].includes(bc)) return "me";
  if (["bt", "ch", "cv", "civil"].includes(bc)) return "chem";
  return null;
}

/**
 * @param {unknown} collegeIdRaw
 * @returns {string[]}
 */
export function hubClusterKeysForCollege(collegeIdRaw) {
  const id = normalizeCollegeId(collegeIdRaw);
  if (id === COLLEGE_ID_RVITM) return [...PLACEMENT_HUB_CLUSTER_KEYS_RVITM];
  return [...PLACEMENT_HUB_CLUSTER_KEYS];
}

/**
 * @param {unknown} clusterRaw
 * @param {unknown} collegeIdRaw
 * @returns {boolean}
 */
export function isHubClusterAllowedForCollege(clusterRaw, collegeIdRaw) {
  const key = normalizePlacementClusterQuery(clusterRaw);
  if (!key) return false;
  return hubClusterKeysForCollege(collegeIdRaw).includes(key);
}
