import { dedupeTestCases, testCaseDedupeKey } from "../../utils/dedupeTestCases.js";
import { normalizeTestCaseFields } from "../../utils/normalizeTestCaseExpectedOutput.js";

export const VISIBLE_SAMPLE_COUNT = 2;
export const HIDDEN_EDGE_COUNT = 2;

/**
 * @param {string} functionSignature e.g. def group_anagrams(strs):
 * @returns {string[]}
 */
export const parsePythonParamNames = (functionSignature) => {
  const sig = String(functionSignature || "").trim();
  const match = sig.match(/def\s+\w+\s*\(([^)]*)\)/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((part) => part.trim().split("=")[0].trim())
    .filter(Boolean);
};

const normalizePool = (testCases) =>
  dedupeTestCases(
    (Array.isArray(testCases) ? testCases : []).map((tc) => normalizeTestCaseFields(tc))
  );

/**
 * Pick up to `count` unique cases preferring `preferHidden` flag when available.
 * @param {object[]} pool
 * @param {Set<string>} excludeKeys
 * @param {number} count
 * @param {boolean|null} preferHidden
 */
const pickUniqueCases = (pool, excludeKeys, count, preferHidden = null) => {
  const picked = [];
  const used = new Set(excludeKeys);

  const tryPick = (filterFn) => {
    for (const tc of pool) {
      if (picked.length >= count) break;
      const key = testCaseDedupeKey(tc);
      if (used.has(key)) continue;
      if (filterFn && !filterFn(tc)) continue;
      picked.push(tc);
      used.add(key);
    }
  };

  if (preferHidden === true) {
    tryPick((tc) => tc.isHidden === true);
    tryPick((tc) => tc.isHidden !== true);
  } else if (preferHidden === false) {
    tryPick((tc) => tc.isHidden !== true);
    tryPick((tc) => tc.isHidden === true);
  } else {
    tryPick(null);
  }

  return picked;
};

/**
 * Build exactly 2 visible sample cases + 2 hidden edge cases (unique by input/output).
 * @param {object[]} testCases
 * @param {{ visibleCount?: number, hiddenCount?: number }} [options]
 * @returns {{
 *   testCases: object[],
 *   visible: object[],
 *   hidden: object[],
 *   hiddenNeeded: number,
 *   visibleNeeded: number,
 * }}
 */
export const buildTwoVisibleTwoHidden = (
  testCases,
  options = {}
) => {
  const visibleCount = options.visibleCount ?? VISIBLE_SAMPLE_COUNT;
  const hiddenCount = options.hiddenCount ?? HIDDEN_EDGE_COUNT;
  const pool = normalizePool(testCases);

  const visible = pickUniqueCases(pool, new Set(), visibleCount, false).map((tc) => ({
    ...tc,
    isHidden: false,
    weight: Number(tc.weight) > 0 ? Number(tc.weight) : 1,
  }));

  const visibleKeys = new Set(visible.map(testCaseDedupeKey));
  let hidden = pickUniqueCases(pool, visibleKeys, hiddenCount, true).map((tc) => ({
    ...tc,
    isHidden: true,
    weight: Number(tc.weight) > 0 ? Number(tc.weight) : 1,
  }));

  if (hidden.length < hiddenCount) {
    const hiddenKeys = new Set(hidden.map(testCaseDedupeKey));
    const extra = pickUniqueCases(pool, new Set([...visibleKeys, ...hiddenKeys]), hiddenCount - hidden.length, null);
    hidden = [
      ...hidden,
      ...extra.map((tc) => ({
        ...tc,
        isHidden: true,
        weight: Number(tc.weight) > 0 ? Number(tc.weight) : 1,
      })),
    ];
  }

  const hiddenNeeded = Math.max(0, hiddenCount - hidden.length);
  const visibleNeeded = Math.max(0, visibleCount - visible.length);

  return {
    testCases: [...visible, ...hidden],
    visible,
    hidden,
    hiddenNeeded,
    visibleNeeded,
  };
};

/**
 * @param {object} testcase
 * @param {string[]} paramNames
 */
export const validateTestCaseInputShape = (testcase, paramNames) => {
  const names = Array.isArray(paramNames) ? paramNames : [];
  const inp = testcase?.input;
  if (names.length === 0) return { ok: true };
  if (!inp || typeof inp !== "object" || Array.isArray(inp)) {
    return { ok: false, reason: "input must be a JSON object keyed by parameter names" };
  }
  const keys = Object.keys(inp);
  const missing = names.filter((n) => !(n in inp));
  if (missing.length > 0) {
    return { ok: false, reason: `input missing keys: ${missing.join(", ")}` };
  }
  const extra = keys.filter((k) => !names.includes(k));
  if (extra.length > 0) {
    return { ok: false, reason: `input has unexpected keys: ${extra.join(", ")}` };
  }
  return { ok: true };
};

/**
 * @param {object[]} cases
 * @param {string[]} paramNames
 */
export const validateGeneratedHiddenCases = (cases, paramNames) => {
  if (!Array.isArray(cases) || cases.length === 0) {
    return { ok: false, reason: "no cases returned" };
  }
  for (const tc of cases) {
    if (tc?.input === undefined) return { ok: false, reason: "case missing input" };
    if (tc?.expectedOutput === undefined) return { ok: false, reason: "case missing expectedOutput" };
    const shape = validateTestCaseInputShape(tc, paramNames);
    if (!shape.ok) return shape;
  }
  const keys = cases.map(testCaseDedupeKey);
  if (new Set(keys).size !== keys.length) {
    return { ok: false, reason: "duplicate generated cases" };
  }
  return { ok: true };
};

export default buildTwoVisibleTwoHidden;
