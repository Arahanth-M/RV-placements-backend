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

  const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length;

  const hasCrore = /\bcrore\b|\bcr\b/.test(str);
  const hasLakhUnit = /\blakh\b|\blakhs\b|\blpa\b/.test(str);

  if (hasCrore) return avg * 1_00_00_000;
  if (hasLakhUnit) return avg * RUPEES_PER_LPA;

  if (numbers.length === 1 && avg >= 100_000) return avg;

  return avg * RUPEES_PER_LPA;
}

/**
 * Sum all values in a plain ctc object (any keys) after normalization.
 * @param {Record<string, unknown>|Map|undefined|null} ctc
 * @returns {number}
 */
export function sumCtcObjectToRupees(ctc) {
  const obj =
    ctc instanceof Map
      ? Object.fromEntries(ctc)
      : ctc && typeof ctc === "object"
        ? ctc
        : {};

  let sum = 0;
  for (const key of Object.keys(obj)) {
    const rupees = normalizeCtcComponentToRupees(obj[key]);
    if (rupees !== null && Number.isFinite(rupees)) sum += rupees;
  }
  return sum;
}

/**
 * @param {number} totalRupees
 * @returns {typeof PLACEMENT_CATEGORY[keyof typeof PLACEMENT_CATEGORY]}
 */
export function categorizeTotalRupees(totalRupees) {
  if (!Number.isFinite(totalRupees) || totalRupees < OPEN_DREAM_MIN_RUPEES) {
    return PLACEMENT_CATEGORY.DREAM;
  }
  return PLACEMENT_CATEGORY.OPEN_DREAM;
}

/**
 * Per-role total, then max across roles (best package sets company tier).
 * @param {{ roles?: Array<{ ctc?: unknown }> }|null|undefined} company
 * @returns {{ totalCtcRupees: number, category: string }}
 */
export function getCompanyPlacementMeta(company) {
  const roles = company?.roles;
  if (!Array.isArray(roles) || roles.length === 0) {
    return { totalCtcRupees: 0, category: PLACEMENT_CATEGORY.DREAM };
  }

  let maxRupees = 0;
  for (const role of roles) {
    const perRole = sumCtcObjectToRupees(role?.ctc);
    if (perRole > maxRupees) maxRupees = perRole;
  }

  return {
    totalCtcRupees: maxRupees,
    category: categorizeTotalRupees(maxRupees),
  };
}

/**
 * Attach category + total for API responses (additive fields).
 * @param {Record<string, unknown>} companyLeanOrDoc
 */
export function attachPlacementCategoryToCompany(companyLeanOrDoc) {
  const { totalCtcRupees, category } = getCompanyPlacementMeta(companyLeanOrDoc);
  return {
    ...companyLeanOrDoc,
    category,
    totalCtcRupees,
  };
}
