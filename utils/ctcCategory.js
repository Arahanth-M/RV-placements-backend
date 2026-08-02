import { getOpenDreamMinRupeesForClusterSync } from "../services/placementHubSettingsService.js";
import {
  COLLEGE_ID_RVCE,
  COLLEGE_ID_RVITM,
  filterRolesForCollege,
  normalizeCollegeId,
} from "./collegeScope.js";

/**
 * Placement tier helpers: unknown-shaped `ctc` objects on each role (Mixed map values).
 * All money is normalized to annual rupees; threshold 10 LPA == 1_000_000 INR.
 */

export const RUPEES_PER_LPA = 100_000;
export const OPEN_DREAM_MIN_RUPEES = 1_000_000; // 10 LPA

export const PLACEMENT_CATEGORY = {
  DREAM: "dream",
  OPEN_DREAM: "open dream",
};

/** Keys on `role.ctc` that hold the total package amount. */
const ROLE_CTC_TOTAL_KEYS = ["CTC", "Ctc", "ctc", "total"];
/** Fallback when no CTC total is present — still excludes variable / bonus breakdown lines. */
const ROLE_BASE_TOTAL_KEYS = ["Base", "base"];

/**
 * Normalize one CTC component (string or number) to annual rupees.
 * @param {unknown} value
 * @returns {number|null} positive rupees, or null if unusable
 */
export function normalizeCtcComponentToRupees(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return null;
    if (value >= 100_000) return value;
    return value * RUPEES_PER_LPA;
  }
  if (typeof value === "string") {
    return parseCtcStringToRupees(value);
  }
  return null;
}

/**
 * @param {string} raw
 * @returns {number|null}
 */
export function parseCtcStringToRupees(raw) {
  const str = String(raw).trim().toLowerCase();
  if (!str) return null;

  const numMatches = str.match(/[\d][\d,]*(?:\.[\d]+)?/g);
  if (!numMatches) return null;
  const numbers = numMatches.map((s) => parseFloat(s.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
  if (numbers.length === 0) return null;

  const isRange =
    str.includes("-") ||
    /\bto\b/.test(str) ||
    (/\bbetween\b/.test(str) && /\band\b/.test(str));

  const total = isRange
    ? numbers.reduce((a, b) => a + b, 0) / numbers.length
    : numbers.reduce((a, b) => a + b, 0);

  const hasCrore = /\bcrore\b|\bcr\b/.test(str);
  const hasLakhUnit = /\blakh\b|\blakhs\b|\blpa\b/.test(str);

  if (hasCrore) return total * 1_00_00_000;
  if (hasLakhUnit) return total * RUPEES_PER_LPA;

  if (numbers.length === 1 && total >= 100_000) return total;

  return total * RUPEES_PER_LPA;
}

/**
 * Read package amount from a role's `ctc` object: CTC first, then Base if CTC is absent.
 * Ignores variable pay, stocks, and other breakdown components.
 * @param {Record<string, unknown>|Map|undefined|null} ctc
 * @returns {number} annual rupees, or 0 when no usable CTC/Base value is present
 */
export function sumCtcObjectToRupees(ctc) {
  const obj =
    ctc instanceof Map
      ? Object.fromEntries(ctc)
      : ctc && typeof ctc === "object"
        ? ctc
        : {};

  const readFirstPositive = (keys) => {
    for (const key of keys) {
      if (!(key in obj)) continue;
      const rupees = normalizeCtcComponentToRupees(obj[key]);
      if (rupees !== null && Number.isFinite(rupees) && rupees > 0) {
        return rupees;
      }
    }
    return null;
  };

  return readFirstPositive(ROLE_CTC_TOTAL_KEYS) ?? readFirstPositive(ROLE_BASE_TOTAL_KEYS) ?? 0;
}

/**
 * @param {number} totalRupees
 * @param {number} [openDreamMinRupees] — cluster-specific threshold (defaults to 10 LPA)
 */
export function categorizeTotalRupees(totalRupees, openDreamMinRupees = OPEN_DREAM_MIN_RUPEES) {
  const threshold =
    Number.isFinite(openDreamMinRupees) && openDreamMinRupees >= 0
      ? openDreamMinRupees
      : OPEN_DREAM_MIN_RUPEES;
  if (!Number.isFinite(totalRupees) || totalRupees < threshold) {
    return PLACEMENT_CATEGORY.DREAM;
  }
  return PLACEMENT_CATEGORY.OPEN_DREAM;
}

/**
 * True when a role has usable CTC (or Base) or a positive internship stipend.
 * @param {{ ctc?: unknown, internshipStipend?: unknown }|null|undefined} role
 * @returns {boolean}
 */
export function roleHasUsableCompensation(role) {
  if (sumCtcObjectToRupees(role?.ctc) > 0) return true;
  const stip = Number(role?.internshipStipend);
  return Number.isFinite(stip) && stip > 0;
}

/**
 * Roles used for dream / open-dream CTC tiering.
 * For RVITM: when no RVITM role has CTC or internship stipend, use RVCE roles
 * so category follows max RVCE CTC (read-time only; does not mutate stored roles).
 * @param {unknown} roles
 * @param {unknown} [collegeIdRaw]
 * @returns {unknown[]}
 */
export function rolesForPlacementCategory(roles, collegeIdRaw) {
  if (!Array.isArray(roles)) return [];
  if (collegeIdRaw == null || String(collegeIdRaw).trim() === "") {
    return roles;
  }
  const collegeId = normalizeCollegeId(collegeIdRaw);
  const scoped = filterRolesForCollege(roles, collegeId);
  if (collegeId !== COLLEGE_ID_RVITM) return scoped;
  if (scoped.some((r) => roleHasUsableCompensation(r))) return scoped;
  return filterRolesForCollege(roles, COLLEGE_ID_RVCE);
}

/**
 * Per-role total, then max across roles (best package sets company tier).
 * @param {{ roles?: Array<{ ctc?: unknown }> }|null|undefined} company
 * @param {{ openDreamMinRupees?: number, collegeId?: unknown }} [options]
 * @returns {{ totalCtcRupees: number, category: string }}
 */
export function getCompanyPlacementMeta(company, options = {}) {
  const openDreamMinRupees = options.openDreamMinRupees;
  const roles =
    options.collegeId != null && String(options.collegeId).trim() !== ""
      ? rolesForPlacementCategory(company?.roles, options.collegeId)
      : Array.isArray(company?.roles)
        ? company.roles
        : [];
  if (roles.length === 0) {
    return { totalCtcRupees: 0, category: PLACEMENT_CATEGORY.DREAM };
  }

  let maxRupees = 0;
  for (const role of roles) {
    const perRole = sumCtcObjectToRupees(
      /** @type {{ ctc?: unknown }} */ (role)?.ctc
    );
    if (perRole > maxRupees) maxRupees = perRole;
  }

  return {
    totalCtcRupees: maxRupees,
    category: categorizeTotalRupees(maxRupees, openDreamMinRupees),
  };
}

/**
 * Attach category + total for API responses (additive fields).
 * @param {Record<string, unknown>} companyLeanOrDoc
 * @param {{ clusterKey?: unknown, placementYear?: unknown, collegeId?: unknown, openDreamMinRupees?: number }} [options]
 */
export function attachPlacementCategoryToCompany(companyLeanOrDoc, options = {}) {
  const clusterRaw =
    options.clusterKey ?? companyLeanOrDoc?.cluster ?? companyLeanOrDoc?.placementListClusterKey;
  const yearRaw =
    options.placementYear ??
    companyLeanOrDoc?.placementVisitYear ??
    companyLeanOrDoc?.placementDreamDetailYear;
  const openDreamMinRupees =
    options.openDreamMinRupees != null
      ? options.openDreamMinRupees
      : getOpenDreamMinRupeesForClusterSync(clusterRaw, yearRaw);
  const { totalCtcRupees, category } = getCompanyPlacementMeta(companyLeanOrDoc, {
    openDreamMinRupees,
    collegeId: options.collegeId,
  });
  return {
    ...companyLeanOrDoc,
    category,
    totalCtcRupees,
  };
}
