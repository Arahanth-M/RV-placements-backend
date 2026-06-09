import { EXECUTION_ERROR, EXECUTION_SUCCESS } from "./executionTypes.js";

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

/** Max UTF-8 bytes for user print capture (visible testcases only); enforced server-side. */
export const USER_DEBUG_OUTPUT_MAX_BYTES = (() => {
  const n = Number(process.env.EXECUTION_USER_DEBUG_MAX_BYTES);
  if (Number.isFinite(n) && n >= 1024 && n <= 512 * 1024) return Math.floor(n);
  return 32 * 1024;
})();

export const truncateUserDebugOutput = (raw) => {
  const s = typeof raw === "string" ? raw : "";
  if (!s) return "";
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const buf = enc.encode(s);
  if (buf.length <= USER_DEBUG_OUTPUT_MAX_BYTES) return s;
  const cut = buf.slice(0, USER_DEBUG_OUTPUT_MAX_BYTES);
  let out = dec.decode(cut);
  if (!out.endsWith("\n")) out += "\n… [truncated]";
  else out += "… [truncated]";
  return out;
};

/** Treat only real truthy hidden flags as hidden (avoids string "false" counting as hidden). */
export const normalizeIsHidden = (value) => {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    return false;
  }
  return Boolean(value);
};

export const sanitizeInput = (value) => {
  if (value == null) return value;
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((item) => sanitizeInput(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, sanitizeInput(val)])
    );
  }
  return value;
};

/** Failure fields for post-submit UI (visible or hidden). */
const buildTestCaseFailureDetail = (item) => ({
  input: sanitizeInput(item?.input ?? null),
  expectedOutput: sanitizeInput(item?.expectedOutput ?? null),
  actualOutput: sanitizeInput(item?.actualOutput ?? null),
  error: toSafeString(item?.error),
});

/**
 * Per hidden testcase for post-submit UI.
 * Passed cases: pass/fail only. Failed cases: include input/expected/actual/error.
 * @param {Array<{ isHidden?: unknown, passed?: boolean }>} results
 */
export const buildHiddenTestResultsFromRows = (results = []) => {
  const rows = Array.isArray(results) ? results : [];
  const hidden = rows.filter((item) => normalizeIsHidden(item?.isHidden) === true);
  return hidden.map((item, idx) => {
    const passed = Boolean(item?.passed);
    const base = { caseNumber: idx + 1, passed };
    if (passed) return base;
    return { ...base, ...buildTestCaseFailureDetail(item) };
  });
};

/**
 * Failed visible testcases for post-submit UI (full failure detail per case).
 * @param {Array<{ isHidden?: unknown, passed?: boolean }>} results
 */
export const buildFailedVisibleTestsFromRows = (results = []) => {
  const rows = Array.isArray(results) ? results : [];
  let visibleIdx = 0;
  const failed = [];
  for (const item of rows) {
    if (normalizeIsHidden(item?.isHidden) === true) continue;
    visibleIdx += 1;
    if (item?.passed === true) continue;
    failed.push({
      caseNumber: visibleIdx,
      passed: false,
      ...buildTestCaseFailureDetail(item),
    });
  }
  return failed;
};

/**
 * Resolve hidden testcase rows for API clients from execution trace (new + legacy).
 */
export const buildHiddenTestResultsForClient = (execution = {}) => {
  if (!execution || typeof execution !== "object") return [];

  const explicit = Array.isArray(execution.hiddenTestResults)
    ? execution.hiddenTestResults
        .filter((row) => row && typeof row === "object")
        .map((row, idx) => {
          const passed = Boolean(row.passed);
          const base = {
            caseNumber: Number(row.caseNumber) > 0 ? Number(row.caseNumber) : idx + 1,
            passed,
          };
          if (passed) return base;
          return {
            ...base,
            input: row.input ?? null,
            expectedOutput: row.expectedOutput ?? null,
            actualOutput: row.actualOutput ?? null,
            error: typeof row.error === "string" ? row.error : "",
          };
        })
    : [];
  if (explicit.length > 0) return explicit;

  const caseResults = Array.isArray(execution.caseResults) ? execution.caseResults : [];
  if (caseResults.length > 0) {
    return buildHiddenTestResultsFromRows(caseResults);
  }

  const total = Math.max(0, Number(execution.hiddenTotalCount) || 0);
  const passed = Math.max(0, Number(execution.hiddenPassedCount) || 0);
  if (total <= 0) return [];

  if (passed === total) {
    return Array.from({ length: total }, (_, i) => ({ caseNumber: i + 1, passed: true }));
  }
  if (passed === 0) {
    return Array.from({ length: total }, (_, i) => ({ caseNumber: i + 1, passed: false }));
  }
  return Array.from({ length: total }, (_, i) => ({
    caseNumber: i + 1,
    passed: i < passed,
  }));
};

export const calculateExecutionSummary = (results = []) => {
  const rows = Array.isArray(results) ? results : [];
  const totalCount = rows.length;
  const passedCount = rows.filter((item) => item?.passed === true).length;
  const failedCount = Math.max(0, totalCount - passedCount);
  const visiblePassedCount = rows.filter(
    (item) => item?.passed === true && normalizeIsHidden(item?.isHidden) !== true
  ).length;
  const hiddenPassedCount = rows.filter(
    (item) => item?.passed === true && normalizeIsHidden(item?.isHidden) === true
  ).length;
  const totalWeight = rows.reduce((sum, item) => sum + Math.max(0, Number(item?.weight) || 1), 0);
  const passedWeight = rows.reduce((sum, item) => {
    const weight = Math.max(0, Number(item?.weight) || 1);
    return item?.passed === true ? sum + weight : sum;
  }, 0);
  const weightedPassRate = totalWeight > 0 ? passedWeight / totalWeight : 0;
  const executionTime = rows.reduce((sum, item) => sum + (Number(item?.executionTime) || 0), 0);
  return {
    totalCount,
    passedCount,
    failedCount,
    visiblePassedCount,
    hiddenPassedCount,
    weightedPassRate,
    executionTime,
  };
};

export const normalizeExecutionResult = (payload = {}) => {
  const normalizedRows = Array.isArray(payload.results)
    ? payload.results.map((row) => ({
        passed: Boolean(row?.passed),
        isHidden: normalizeIsHidden(row?.isHidden),
        weight: Math.max(0, Number(row?.weight) || 1),
        input: sanitizeInput(row?.input ?? null),
        expectedOutput: sanitizeInput(row?.expectedOutput ?? null),
        actualOutput: sanitizeInput(row?.actualOutput ?? null),
        error: toSafeString(row?.error),
        executionTime: Number(row?.executionTime) || 0,
      }))
    : [];

  const summary = calculateExecutionSummary(normalizedRows);
  const userDebugRaw = typeof payload.userDebugOutput === "string" ? payload.userDebugOutput : "";
  return {
    status:
      toSafeString(payload.status) ||
      (summary.failedCount > 0 ? EXECUTION_ERROR : EXECUTION_SUCCESS),
    passedCount: summary.passedCount,
    failedCount: summary.failedCount,
    totalCount: summary.totalCount,
    visiblePassedCount: summary.visiblePassedCount,
    hiddenPassedCount: summary.hiddenPassedCount,
    weightedPassRate: summary.weightedPassRate,
    executionTime: Number(payload.executionTime) || summary.executionTime,
    memoryUsed: Number(payload.memoryUsed) || 0,
    results: normalizedRows,
    error: toSafeString(payload.error),
    userDebugOutput: truncateUserDebugOutput(userDebugRaw),
  };
};

export default {
  normalizeExecutionResult,
  sanitizeInput,
  calculateExecutionSummary,
  normalizeIsHidden,
  buildHiddenTestResultsFromRows,
  buildFailedVisibleTestsFromRows,
  buildHiddenTestResultsForClient,
  truncateUserDebugOutput,
  USER_DEBUG_OUTPUT_MAX_BYTES,
};
