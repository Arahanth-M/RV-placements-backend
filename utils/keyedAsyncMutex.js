/** @type {Map<string, Promise<void>>} */
const tailByKey = new Map();

/**
 * Shared lock key for all read-modify-write updates to one `company_visits` row
 * (admin submission approve + SPC placement/conversion stats).
 * @param {unknown} visitId
 * @returns {string}
 */
export function buildCompanyVisitWriteLockKey(visitId) {
  return `company-visit-write:${String(visitId || "").trim() || "unknown"}`;
}

/**
 * Serialize async work per key (e.g. one company visit write at a time).
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withKeyedAsyncMutex(key, fn) {
  const safeKey = String(key || "").trim() || "default";
  const previous = tailByKey.get(safeKey) || Promise.resolve();

  let release = () => {};
  const current = new Promise((reso