/**
 * Placement cycles exposed on company visits, list/detail APIs, and caches.
 *
 * To add a new year (e.g. 2028): extend {@link COMPANY_DETAIL_VISIT_YEARS}, then update
 * frontend hub years (`CompanyStats`, `CompanyDetails`, `CompanyCard`), Joi/Mongoose
 * validations, and any admin dashboards — search the repo for the previous max year.
 */
export const COMPANY_DETAIL_VISIT_YEARS = Object.freeze([2026, 2027, 2028]);

/** Legacy year-stats tables (2024/2025) + hub visit years — admin Open dream thresholds. */
export const PLACEMENT_OPEN_DREAM_SETTING_YEARS = Object.freeze([
  2024,
  2025,
  ...COMPANY_DETAIL_VISIT_YEARS,
]);

/** Default cycle when `year` is omitted on a visit or query normalizes invalid input. */
export const COMPANY_VISIT_DEFAULT_YEAR = 2026;

/**
 * @param {unknown} raw
 * @returns {number|undefined}
 */
export function normalizePlacementOpenDreamSettingYear(raw) {
  const y = Number(raw);
  if (!Number.isFinite(y)) return undefined;
  return PLACEMENT_OPEN_DREAM_SETTING_YEARS.includes(y) ? y : undefined;
}

/**
 * Use in `$match` (and Mongoose `find`) so `company_visits.year` matches hub years even when
 * stored as string (`"2027"`), Long, or other coercible BSON types — not only strict int32.
 * Combine with `status: "approved"` (and other field predicates) in the same match object.
 *
 * @returns {{ $expr: Record<string, unknown> }}
 */
export function matchApprovedVisitYearInDetailYearsExpr() {
  const years = [...COMPANY_DETAIL_VISIT_YEARS];
  return {
    $expr: {
      $in: [
        {
          $convert: {
            input: "$year",
            to: "long",
            onError: -1,
            onNull: -1,
          },
        },
        years,
      ],
    },
  };
}
