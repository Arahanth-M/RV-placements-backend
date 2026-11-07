import mongoose from "mongoose";
import CompanyPlatformContent from "../models/CompanyPlatformContent.js";
import CompanyStatic from "../models/CompanyStatic.js";

const SCOPES = new Set(["oa", "interview"]);
const CATEGORY_KEYS = new Set([
  "question",
  "intuition",
  "explanation",
  "cpp",
  "java",
  "python",
  "all",
]);

function asObjectId(value) {
  try {
    return new mongoose.Types.ObjectId(String(value || ""));
  } catch {
    return null;
  }
}

function normalizeFailedIndexes(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || seen.has(index)) continue;
    seen.add(index);
    out.push(index);
  }
  return out;
}

function asProgress(value) {
  if (value === true) {
    return { passed: 0, remaining: 0, total: 0, complete: true, failedIndexes: [] };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const passed = Math.max(0, Number(value.passed) || 0);
  const remaining = Math.max(0, Number(value.remaining) || 0);
  const total = Math.max(0, Number(value.total) || 0) || passed + remaining;
  // Explicit complete:false must win — otherwise Everything with remaining=0 looked done.
  const complete =
    value.complete === true
      ? true
      : value.complete === false
        ? false
        : total > 0 && remaining === 0;
  return {
    passed,
    remaining,
    total,
    complete,
    failedIndexes: normalizeFailedIndexes(value.failedIndexes),
  };
}

const FIELD_KEYS = ["question", "intuition", "explanation", "cpp", "java", "python"];

function recomputeEverythingProgress(state) {
  let completeCount = 0;
  let trackedCount = 0;
  let itemPassed = 0;
  let itemTotal = 0;
  for (const field of FIELD_KEYS) {
    const progress = asProgress(state?.[field]);
    if (!progress) continue;
    trackedCount += 1;
    itemPassed += progress.passed;
    itemTotal += progress.total;
    if (progress.complete) completeCount += 1;
  }
  const fieldCount = FIELD_KEYS.length;
  const allFieldsPresent = FIELD_KEYS.every((field) => Boolean(asProgress(state?.[field])));
  const complete = allFieldsPresent && completeCount === fieldCount;
  if (complete) {
    return {
      passed: itemPassed,
      remaining: 0,
      total: itemTotal,
      complete: true,
      failedIndexes: [],
    };
  }
  if (trackedCount < 1) return null;
  return {
    passed: completeCount,
    remaining: fieldCount - completeCount,
    total: fieldCount,
    complete: false,
    failedIndexes: [],
  };
}

/** Normalize a scope map of category → progress. */
export function normalizeEnhanceCompletionMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!CATEGORY_KEYS.has(key)) continue;
    if (key === "all") continue; // recomputed below
    const progress = asProgress(value);
    if (progress) out[key] = progress;
  }
  const repairedAll = recomputeEverythingProgress(out);
  if (repairedAll) out.all = repairedAll;
  return out;
}

export function normalizeEnhanceCompletionDoc(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    oa: normalizeEnhanceCompletionMap(src.oa),
    interview: normalizeEnhanceCompletionMap(src.interview),
  };
}

/**
 * Persist enhance completion for one OA/interview scope on a company.
 * @param {{ companyId: string, scope: "oa"|"interview", completion: Record<string, unknown> }} input
 */
export async function updatePlatformEnhanceCompletion(input = {}) {
  const oid = asObjectId(input.companyId);
  if (!oid) {
    const err = new Error("Invalid company id");
    err.status = 400;
    throw err;
  }
  const scope = String(input.scope || "").trim().toLowerCase();
  if (!SCOPES.has(scope)) {
    const err = new Error('scope must be "oa" or "interview"');
    err.status = 400;
    throw err;
  }
  const company = await CompanyStatic.findById(oid).select({ _id: 1 }).lean();
  if (!company) {
    const err = new Error("Company not found");
    err.status = 404;
    throw err;
  }

  const completion = normalizeEnhanceCompletionMap(input.completion);
  const path = `enhanceCompletion.${scope}`;
  const doc = await CompanyPlatformContent.findOneAndUpdate(
    { companyId: oid },
    {
      $set: { [path]: completion },
      $setOnInsert: { companyId: oid },
    },
    { upsert: true, new: true, lean: true }
  );

  return {
    companyId: String(oid),
    scope,
    platformEnhanceCompletion: normalizeEnhanceCompletionDoc(doc?.enhanceCompletion),
  };
}
