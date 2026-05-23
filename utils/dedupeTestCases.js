/**
 * Remove duplicate interview coding testcases by (input, expectedOutput).
 * When duplicates differ only by isHidden, keeps the visible row (isHidden !== true).
 */

const stableSerialize = (value) => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableSerialize(value[k])}`).join(",")}}`;
};

/** Stable key for duplicate detection (input + expected output only). */
export const testCaseDedupeKey = (testcase) =>
  stableSerialize({
    input: testcase?.input ?? null,
    expectedOutput: testcase?.expectedOutput ?? null,
  });

const pickPreferredTestCase = (existing, incoming) => {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const existingHidden = Boolean(existing.isHidden);
  const incomingHidden = Boolean(incoming.isHidden);
  if (existingHidden && !incomingHidden) return incoming;
  return existing;
};

/**
 * @param {unknown[]} testCases
 * @returns {object[]} deduped in first-seen order (visible wins over hidden for same key)
 */
export const dedupeTestCases = (testCases) => {
  if (!Array.isArray(testCases) || testCases.length === 0) return [];

  const order = [];
  const byKey = new Map();

  for (const testcase of testCases) {
    if (!testcase || typeof testcase !== "object") continue;
    const key = testCaseDedupeKey(testcase);
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, testcase);
      continue;
    }
    byKey.set(key, pickPreferredTestCase(byKey.get(key), testcase));
  }

  return order.map((key) => byKey.get(key)).filter(Boolean);
};

export default dedupeTestCases;
