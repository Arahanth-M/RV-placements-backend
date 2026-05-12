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
  truncateUserDebugOutput,
  USER_DEBUG_OUTPUT_MAX_BYTES,
};
