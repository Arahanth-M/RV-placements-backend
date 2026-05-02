/**
 * Placement cycles exposed on company visits, list/detail APIs, and caches.
 *
 * To add a new year (e.g. 2028): extend {@link COMPANY_DETAIL_VISIT_YEARS}, then update
 * frontend hub years (`CompanyStats`, `CompanyDetails`, `CompanyCard`), Joi/Mongoose
 * validations, and any admin dashboards — search the repo for the previous max year.
 */
export const COMPANY_DETAIL_VISIT_YEARS = Object.freeze([2026, 2027, 2028]);

/** Default cycle when `year` is omitted on a visit or query normalizes invalid input. */
export const COMPANY_VISIT_DEFAULT_YEAR = 2026;
