/** Hub keys used for `?cluster=` filters and per-cluster placement settings. */
export const PLACEMENT_HUB_CLUSTER_KEYS = Object.freeze(["cs", "ec", "me", "chem"]);

export const PLACEMENT_HUB_CLUSTER_LABELS = Object.freeze({
  cs: "Computer Science & Engineering",
  ec: "Electronics & Communication",
  me: "Mechanical Engineering",
  chem: "Chemical Sciences (CH / Civil / BT)",
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
 * @param {unknown} raw — e.g. `req.query.cluster` or `req.query.placementCluster`
 * @returns {string|null}
 */
export function normalizePlacementClusterQuery(raw) {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!v) return null;
  if (v === "cs" || v === "cse") return "cs";
  if (v === "ec" || v === "ece") return "ec";
  if (v === "me") return "me";
  if (v === "chem" || v === "ch" || v === "bt") return "chem";
  return v;
}

/**
 * Map stored visit.cluster → hub key. Handles short codes and full names, e.g.
 * `"Computer Science and Engineering"` → `"cs"`.
 *
 * @param {unknown} raw — visit.cluster on company_visits
 * @returns {string}
 */
/** Map SPC / PPO student branch code → placement hub key (cs | ec | me | chem). */
export function placementHubClusterFromPpoBranchCode(branchCodeRaw) {
  const bc = String(branchCodeRaw ?? "")
    .trim()
    .toLowerCase();
  if (!bc) return null;
  if (["cd", "cy", "ise", "cse", "aiml"].includes(bc)) return "cs";
  if (["ece", "ete", "eie", "eee"].includes(bc)) return "ec";
  if (["ase", "iem", "me"].includes(bc)) return "me";
  if (["bt", "ch", "civil"].includes(bc)) return "chem";
  return null;
}

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
