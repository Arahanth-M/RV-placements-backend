/** Placement years supported for general stats upload and public display. */
export const GENERAL_STATS_YEARS = Object.freeze([2024, 2025, 2026, 2027, 2028]);

export const DEFAULT_GENERAL_STATS_YEAR = 2026;

/**
 * @param {unknown} yearRaw
 * @returns {number|null}
 */
export function parseGeneralStatsYear(yearRaw) {
  const y = Number.parseInt(String(yearRaw), 10);
  if (!Number.isFinite(y) || !GENERAL_STATS_YEARS.includes(y)) {
    return null;
  }
  return y;
}
