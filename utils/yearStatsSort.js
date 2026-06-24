/**
 * Sort legacy year-stats rows (2024/2025) by Sl. No / serial column when present.
 */

function normalizeFieldKey(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

const SERIAL_FIELD_KEYS = new Set([
  "slno",
  "sl",
  "sno",
  "serialno",
  "serialnumber",
  "srno",
]);

/**
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {string|null}
 */
export function findYearStatsSerialFieldKey(row) {
  if (!row || typeof row !== "object") return null;
  for (const key of Object.keys(row)) {
    if (key === "_id" || key === "__v") continue;
    const norm = normalizeFieldKey(key);
    if (SERIAL_FIELD_KEYS.has(norm)) return key;
    if (/^sl.*no$/.test(norm) || /^sr.*no$/.test(norm)) return key;
  }
  return null;
}

/**
 * @param {Record<string, unknown>[]|null|undefined} rows
 * @returns {string|null}
 */
export function findYearStatsSerialFieldKeyFromRows(rows) {
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    const key = findYearStatsSerialFieldKey(row);
    if (key) return key;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseYearStatsSerialNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const str = String(value).trim();
  const leading = str.match(/^(\d+(?:\.\d+)?)/);
  if (leading) {
    const n = Number(leading[1]);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @param {string|null} serialKey
 * @returns {number}
 */
export function compareYearStatsBySerial(a, b, serialKey) {
  if (!serialKey) return 0;
  const aNum = parseYearStatsSerialNumber(a?.[serialKey]);
  const bNum = parseYearStatsSerialNumber(b?.[serialKey]);
  if (aNum !== null && bNum !== null && aNum !== bNum) return aNum - bNum;
  if (aNum !== null && bNum === null) return -1;
  if (aNum === null && bNum !== null) return 1;
  return String(a?._id ?? "").localeCompare(String(b?._id ?? ""));
}

/**
 * @param {Record<string, unknown>[]|null|undefined} rows
 * @returns {Record<string, unknown>[]}
 */
export function sortYearStatsRows(rows) {
  if (!Array.isArray(rows) || rows.length <= 1) {
    return Array.isArray(rows) ? rows : [];
  }
  const serialKey = findYearStatsSerialFieldKeyFromRows(rows);
  if (!serialKey) return [...rows];
  return [...rows].sort((a, b) => compareYearStatsBySerial(a, b, serialKey));
}
