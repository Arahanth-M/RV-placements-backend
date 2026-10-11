import { COLLEGE_ID_RVCE, collegeIdOfScopedRow } from "./collegeScope.js";

const PLACEHOLDER_KEYS = new Set(["tbd", "tba", "tbc", "na"]);

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * True when a visit role title is empty or a placeholder such as TBD.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlaceholderVisitRoleName(value) {
  const text = compact(value).toLowerCase();
  if (!text) return true;
  const key = text.replace(/[^a-z0-9]/g, "");
  if (PLACEHOLDER_KEYS.has(key)) return true;
  return (
    text === "to be decided" ||
    text === "to be determined" ||
    text === "to be confirmed" ||
    text === "n/a"
  );
}

/**
 * @param {unknown} role
 * @returns {string}
 */
export function visitRoleName(role) {
  if (typeof role === "string") return compact(role);
  if (!role || typeof role !== "object") return "";
  const row = /** @type {{ roleName?: unknown, role?: unknown, name?: unknown }} */ (role);
  return compact(row.roleName ?? row.role ?? row.name);
}

/**
 * Untagged visit roles count as RVCE. RVITM-tagged rows are left out.
 * @param {unknown} role
 * @returns {boolean}
 */
export function isRvceVisitRole(role) {
  if (typeof role === "string") return true;
  if (!role || typeof role !== "object" || Array.isArray(role)) return false;
  return collegeIdOfScopedRow(role) === COLLEGE_ID_RVCE;
}

/**
 * Unique RVCE role titles from visit documents. Skips TBD and other placeholders.
 * @param {unknown} visits
 * @returns {string[]}
 */
export function collectRvceVisitRoleNames(visits) {
  const seen = new Set();
  /** @type {string[]} */
  const roles = [];
  for (const visit of Array.isArray(visits) ? visits : []) {
    const rows = Array.isArray(visit?.roles) ? visit.roles : [];
    for (const row of rows) {
      if (!isRvceVisitRole(row)) continue;
      const name = visitRoleName(row);
      if (isPlaceholderVisitRoleName(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      roles.push(name);
    }
  }
  roles.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return roles;
}

/**
 * Campus roles first, then fresher suggestions that are not already listed.
 * @param {unknown} visitRoles
 * @param {unknown} suggestedRoles
 * @returns {string[]}
 */
export function mergeResearchRoleOptions(visitRoles, suggestedRoles) {
  const seen = new Set();
  /** @type {string[]} */
  const roles = [];
  const add = (value) => {
    const name = compact(value);
    if (isPlaceholderVisitRoleName(name)) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    roles.push(name);
  };
  for (const name of Array.isArray(visitRoles) ? visitRoles : []) add(name);
  for (const name of Array.isArray(suggestedRoles) ? suggestedRoles : []) add(name);
  return roles;
}
