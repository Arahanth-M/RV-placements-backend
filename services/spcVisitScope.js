/**
 * Scope approved company visits for SPC writes by placement year and branch hub (cluster).
 */
import {
  clusterKeyFromPlacementVisitClusterField,
  placementHubClusterFromPpoBranchCode,
} from "../utils/placementCluster.js";
import {
  COMPANY_DETAIL_VISIT_YEARS,
  COMPANY_VISIT_DEFAULT_YEAR,
} from "../utils/placementYears.js";

/** @param {unknown} raw */
function normalizeYearForMessage(raw) {
  const n = Number(raw);
  if (Number.isFinite(n) && COMPANY_DETAIL_VISIT_YEARS.includes(n)) return n;
  return COMPANY_VISIT_DEFAULT_YEAR;
}

/**
 * Filter visit candidates to the hub implied by the student's branch code.
 * @param {Record<string, unknown>[]} candidates
 * @param {unknown} branchCodeRaw
 * @param {{ strict?: boolean }} [opts] — when strict, do not fall back to unscoped pool if hub has no rows
 * @returns {{ visits: Record<string, unknown>[], hub: string|null, strictMiss: boolean }}
 */
export function scopeVisitsByBranchCluster(candidates, branchCodeRaw, opts = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const hub = placementHubClusterFromPpoBranchCode(branchCodeRaw);
  if (!hub) {
    return { visits: list, hub: null, strictMiss: false };
  }
  const scoped = list.filter(
    (v) => clusterKeyFromPlacementVisitClusterField(v?.cluster) === hub
  );
  if (scoped.length > 0) {
    return { visits: scoped, hub, strictMiss: false };
  }
  if (opts.strict) {
    return { visits: [], hub, strictMiss: true };
  }
  return { visits: list, hub, strictMiss: false };
}

/**
 * @param {unknown} yearRaw
 * @param {unknown} branchCodeRaw
 * @returns {string}
 */
export function spcVisitScopeErrorMessage(yearRaw, branchCodeRaw) {
  const year = normalizeYearForMessage(yearRaw);
  const hub = placementHubClusterFromPpoBranchCode(branchCodeRaw);
  const branch = String(branchCodeRaw || "").trim().toUpperCase();
  if (hub) {
    return `No approved company visit for placement year ${year} and ${branch} hub (${hub}). Add or approve the visit for that department cluster first.`;
  }
  return `No approved company visit for placement year ${year}.`;
}
