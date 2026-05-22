/**
 * Stricter scoring adjustments for interview slots with sourceType "generated" only.
 * Bank / retrieved and code_execution (DSA) paths must not use these helpers.
 */

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

/** When rubric has no must-have rows, default coverage for generated questions. */
export const LLM_GENERATED_EMPTY_MUST_HAVE_COVERAGE = 0;

export const LLM_GENERATED_SCORE_CAPS = {
  incorrect: 3,
  weakPartial: 5,
  correct: 10,
};

export const LLM_GENERATED_LOW_MUST_HAVE_COVERAGE_THRESHOLD = 0.5;
export const LLM_GENERATED_LOW_MUST_HAVE_MAX_NORMALIZED = 0.35;

export const LLM_GENERATED_ANTI_GAMING_RELEVANCE = 0.5;
export const LLM_GENERATED_ANTI_GAMING_MAX_COVERAGE = 0.15;
export const LLM_GENERATED_ANTI_GAMING_MAX_NORMALIZED = 0.32;

/**
 * @param {object} rubricSummary - output of buildRubricBuckets
 * @param {number} relevance - 0..1
 * @param {number} normalizedScore - 0..1 before caps
 */
export function applyLlmGeneratedDeterministicOverrides(
  rubricSummary,
  relevance,
  normalizedScore
) {
  let score = clamp01(normalizedScore);
  const mustHaveCoverage = Number(rubricSummary?.mustHaveCoverage) || 0;
  const rubricCoverage = Number(rubricSummary?.coverage) || 0;

  if (mustHaveCoverage < LLM_GENERATED_LOW_MUST_HAVE_COVERAGE_THRESHOLD) {
    score = Math.min(score, LLM_GENERATED_LOW_MUST_HAVE_MAX_NORMALIZED);
  }

  if (
    relevance >= LLM_GENERATED_ANTI_GAMING_RELEVANCE &&
    rubricCoverage <= LLM_GENERATED_ANTI_GAMING_MAX_COVERAGE
  ) {
    score = Math.min(score, LLM_GENERATED_ANTI_GAMING_MAX_NORMALIZED);
  }

  return clamp01(score);
}

/**
 * @param {string} verdict - correct | partial | incorrect
 * @param {number} normalizedScore - 0..1
 * @param {{ factuallyCorrect?: boolean }} factuality
 */
export function applyLlmGeneratedVerdictAndFactualityCaps(
  verdict,
  normalizedScore,
  factuality = {}
) {
  let score = clamp01(normalizedScore);
  let finalVerdict = toSafeString(verdict).toLowerCase() || "partial";

  if (factuality?.factuallyCorrect === false) {
    finalVerdict = "incorrect";
    score = Math.min(score, 0.28);
  }

  if (finalVerdict === "incorrect") {
    score = Math.min(score, LLM_GENERATED_SCORE_CAPS.incorrect / 10);
  } else if (finalVerdict === "partial") {
    const weakPartial =
      score < 0.75 ||
      factuality?.factuallyCorrect === false;
    if (weakPartial) {
      score = Math.min(score, LLM_GENERATED_SCORE_CAPS.weakPartial / 10);
    }
  }

  return {
    verdict: finalVerdict,
    normalizedScore: clamp01(score),
    finalScore: Math.max(1, Math.min(10, Math.round(clamp01(score) * 10))),
  };
}

/**
 * Cap optimistic LLM subscores for generated questions.
 * @param {Record<string, number>} llmSubscores
 */
export function clampLlmSubscoresForGenerated(llmSubscores) {
  const out = {};
  for (const [key, value] of Object.entries(llmSubscores || {})) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    out[key] = Math.min(0.3, clamp01(n));
  }
  return out;
}

export function deriveStrictVerdictForGenerated({
  llmVerdict,
  relevance,
  mustHaveCoverage,
  criticalMisses,
  normalizedScore,
  wordCount,
  factuallyCorrect,
}) {
  if (factuallyCorrect === false) return "incorrect";
  if (wordCount <= 4 || relevance < 0.45) return "incorrect";
  if (Array.isArray(criticalMisses) && criticalMisses.length >= 2) return "incorrect";
  if (mustHaveCoverage < 0.5) return "incorrect";

  const safe = toSafeString(llmVerdict).toLowerCase();
  if (safe === "correct" && normalizedScore >= 0.82 && mustHaveCoverage >= 0.85 && relevance >= 0.75) {
    return "correct";
  }
  if (normalizedScore >= 0.85 && mustHaveCoverage >= 0.9 && relevance >= 0.78) {
    return "correct";
  }
  if (normalizedScore < 0.45 || mustHaveCoverage < 0.67) {
    return safe === "correct" ? "partial" : safe || "partial";
  }
  return safe === "incorrect" ? "incorrect" : safe || "partial";
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

export function isLlmGeneratedQuestionSource(questionSource) {
  return toSafeString(questionSource).toLowerCase() === "generated";
}
