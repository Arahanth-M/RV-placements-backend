/**
 * Shared rules for DSA / code_execution grading: validation, safe cloning, and misconfigured outcomes.
 */

export const CODE_GRADING_MISCONFIGURED_VERSION = "code_execution_misconfigured_v1";

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

/** Interview round label (e.g. session round.type) implies bank coding questions with testcases. */
export const roundTypeImpliesCodeExecutionInterview = (roundType) => {
  const rt = toSafeString(roundType).toLowerCase();
  if (!rt) return false;
  return (
    rt.includes("dsa") ||
    rt.includes("coding") ||
    rt.includes("algorithm") ||
    rt.includes("data structure") ||
    rt.includes("programming") ||
    rt.includes("technical") ||
    rt.includes("software") ||
    rt.includes("developer") ||
    rt.includes("leetcode")
  );
};

/**
 * Bank document has everything needed to grade a coding submission for a DSA-style interview round.
 */
export const bankDocSatisfiesCodeGrading = (interviewRoundType, doc) => {
  if (!roundTypeImpliesCodeExecutionInterview(interviewRoundType)) return true;
  if (!doc || typeof doc !== "object") return false;
  const qid = toSafeString(doc.questionId);
  const tests = Array.isArray(doc.testCases) ? doc.testCases : [];
  const sig = toSafeString(doc.dsaMetadata?.functionSignature);
  if (!qid || tests.length === 0 || !sig) return false;
  const bankSql = String(doc.roundType || "").toUpperCase() === "SQL";
  const strat = toSafeString(doc.evaluationStrategy).toLowerCase();
  if (bankSql || strat === "sql_execution") return false;
  return true;
};

export const cloneSerializable = (value) => {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

export const logCodeGradingGuard = (event, details = {}) => {
  try {
    console.warn(`[code-grading-guard] ${event}`, details);
  } catch {
    // ignore
  }
};

/**
 * When code_execution is required but no testcases are wired — no sandbox, no rubric LLM fallback.
 * score null per product requirement for "misconfigured" grading.
 */
export const buildMisconfiguredCodeGradingEvaluation = ({
  reason = "missing_testcases",
  questionId = "",
} = {}) => {
  const hint =
    reason === "missing_function_signature"
      ? "This coding question is missing a function signature in the bank."
      : "This coding question is not wired to any test cases in the bank.";

  logCodeGradingGuard("misconfigured_code_grading", { reason, questionId });

  return {
    type: "code_execution",
    score: null,
    verdict: "incorrect",
    feedback: `Grading is temporarily unavailable (${hint}). Your answer was received but could not be auto-scored. Please contact support if this persists.`,
    evaluationTrace: {
      scoringVersion: CODE_GRADING_MISCONFIGURED_VERSION,
      questionType: "code_execution",
      expectedAnswerMode: "code",
      verdict: "incorrect",
      confidence: 0,
      relevance: 0,
      coverage: 0,
      correctness: 0,
      communication: 0,
      matchedRubricPoints: [],
      missingRubricPoints: [],
      criticalMisses: [reason],
      subscores: {},
      execution: {
        status: "MISCONFIGURED",
        passedCount: 0,
        failedCount: 0,
        totalCount: 0,
        visiblePassedCount: 0,
        visibleTotalCount: 0,
        hiddenPassedCount: 0,
        hiddenTotalCount: 0,
        executionTime: 0,
        weightedPassRate: 0,
        failedTests: [],
        userDebugOutput: "",
      },
    },
  };
};
