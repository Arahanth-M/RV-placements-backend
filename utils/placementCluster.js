/**
 * Placement hub cluster: query params and visit `company_visits.cluster` routing.
 *
 * **DB reality (`company_visits.cluster`):** values are often full programme names, not short codes.
 * Example: CS rows use `"Computer Science and Engineering"` (not `"cs"`). EC/ME similarly use long
 * department strings. Normalization below uses keyword heuristics so listing, detail `placementCluster`,
 * and hub filters stay consistent. **Empty `cluster` still defaults to CS** (legacy rows); real EC/ME
 * visits should set `cluster` explicitly or they can be misclassified as CS.
 */

/**
 * @param {unknown} raw — e.g. `req.query.cluster` or `req.query.placementCluster`
 * @returns {"cs"|"ec"|"me"|null}
 */
export function normalizePlacementClusterQuery(raw) {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "cs" || v === "cse") return "cs";
  if (v === "ec" || v === "ece") return "ec";
  if (v === "me") return "me";
  return null;
}

/**
 * Map stored visit.cluster → hub key. Handles short codes and full names, e.g.
 * `"Computer Science and Engineering"` → `"cs"`.
 *
 * @param {unknown} raw — visit.cluster on company_visits
 * @returns {"cs"|"ec"|"me"}
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
  return "cs";
}
