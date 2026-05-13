import { executeCode, normalizeExecutionLanguage } from "../codeExecution/executeCode.js";
import {
  EXECUTION_COMPILATION_ERROR,
  EXECUTION_ERROR,
  EXECUTION_RUNTIME_ERROR,
  EXECUTION_SUCCESS,
  EXECUTION_TIMEOUT,
} from "../codeExecution/executionTypes.js";
import { buildMisconfiguredCodeGradingEvaluation } from "../interviewCodeGradingGuards.js";
import { logInterviewDsaLlmDebug } from "../interviewDebugLog.js";

const clamp01 = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
};

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const extractExecutableCode = (answer = "", language = "python") => {
  const raw = toSafeString(answer);
  if (!raw) return "";

  if (language === "cpp") {
    const cppFenced = [...raw.matchAll(/```(?:cpp|cxx|c\+\+)\s*([\s\S]*?)```/gi)];
    if (cppFenced.length > 0) {
      const best = toSafeString(cppFenced[cppFenced.length - 1]?.[1] || "");
      if (best) return best;
    }
  }

  if (language === "java") {
    const javaFenced = [...raw.matchAll(/```(?:java)\s*([\s\S]*?)```/gi)];
    if (javaFenced.length > 0) {
      const best = toSafeString(javaFenced[javaFenced.length - 1]?.[1] || "");
      if (best) return best;
    }
  }

  const pyFenced = [...raw.matchAll(/```(?:python|py)?\s*([\s\S]*?)```/gi)];
  if (pyFenced.length > 0) {
    const best = toSafeString(pyFenced[pyFenced.length - 1]?.[1] || "");
    if (best) return best;
  }

  const codeMarkerMatch = raw.match(/(?:^|\n)\s*code\s*:\s*\n([\s\S]*)$/i);
  if (codeMarkerMatch?.[1]) {
    const extracted = toSafeString(codeMarkerMatch[1]);
    if (extracted) return extracted;
  }

  const lines = raw.split("\n");
  if (language === "cpp") {
    const cppStartIdx = lines.findIndex((line) =>
      /^\s*(#include\s+|using\s+namespace|template\s*<|std::|vector\s*<|int\s+\w+\s*\(|bool\s+\w+\s*\(|long\s+long\s+\w+\s*\(|class\s+)/.test(line)
    );
    if (cppStartIdx >= 0) {
      const extracted = toSafeString(lines.slice(cppStartIdx).join("\n"));
      if (extracted) return extracted;
    }
  }

  if (language === "java") {
    const javaStartIdx = lines.findIndex((line) =>
      /^\s*(package\s+|import\s+java\.|public\s+class\s+|class\s+\w+)/.test(line)
    );
    if (javaStartIdx >= 0) {
      const extracted = toSafeString(lines.slice(javaStartIdx).join("\n"));
      if (extracted) return extracted;
    }
  }

  const pyStartIdx = lines.findIndex((line) =>
    /^\s*(def\s+\w+\s*\(|class\s+\w+|from\s+\w+|import\s+\w+|if\s+__name__\s*==)/.test(line)
  );
  if (pyStartIdx >= 0) {
    const extracted = toSafeString(lines.slice(pyStartIdx).join("\n"));
    if (extracted) return extracted;
  }

  return raw;
};

/**
 * Execution-first evaluator for coding rounds.
 * Preserves existing output contract while making testcase pass-rate dominant.
 */
export const evaluateCodeExecution = async (payload) => {
  const testCases = Array.isArray(payload?.testCases)
    ? payload.testCases
    : Array.isArray(payload?.metadata?.testCases)
    ? payload.metadata.testCases
    : [];
  if (!Array.isArray(testCases) || testCases.length === 0) {
    return buildMisconfiguredCodeGradingEvaluation({
      reason: "missing_testcases",
      questionId: String(payload?.metadata?.questionId || "").trim(),
    });
  }
  const fs = String(payload?.functionSignature || payload?.metadata?.functionSignature || "").trim();
  if (!fs) {
    return buildMisconfiguredCodeGradingEvaluation({
      reason: "missing_function_signature",
      questionId: String(payload?.metadata?.questionId || "").trim(),
    });
  }
  const language = normalizeExecutionLanguage(payload?.language);
  const executableCode = extractExecutableCode(
    typeof payload?.answer === "string" ? payload.answer : "",
    language
  );

  const executionResult = await executeCode({
    language,
    code: executableCode,
    testCases,
    functionSignature: payload?.functionSignature || payload?.metadata?.functionSignature || "",
    jobId: payload?.jobId,
  });

  const totalCount = Number(executionResult?.totalCount) || 0;
  const passedCount = Number(executionResult?.passedCount) || 0;
  const failedCount = Number(executionResult?.failedCount) || Math.max(0, totalCount - passedCount);
  const visiblePassedCount = Number(executionResult?.visiblePassedCount) || 0;
  const hiddenPassedCount = Number(executionResult?.hiddenPassedCount) || 0;
  const passRate = totalCount > 0 ? clamp01(passedCount / totalCount) : 0;
  const weightedPassRate = clamp01(
    Number.isFinite(Number(executionResult?.weightedPassRate))
      ? Number(executionResult.weightedPassRate)
      : passRate
  );
  const visibleTotalCount = Array.isArray(executionResult?.results)
    ? executionResult.results.filter((item) => item?.isHidden !== true).length
    : Math.max(0, totalCount);
  const hiddenTotalCount = Math.max(0, totalCount - visibleTotalCount);

  const executionFailureStatuses = new Set([
    EXECUTION_TIMEOUT,
    EXECUTION_COMPILATION_ERROR,
    EXECUTION_RUNTIME_ERROR,
    EXECUTION_ERROR,
  ]);
  const executionFailedOverall = executionFailureStatuses.has(executionResult?.status);
  const allTestsPassed =
    (executionResult?.status === EXECUTION_SUCCESS ||
      (totalCount > 0 && passedCount === totalCount && !executionFailedOverall)) &&
    totalCount > 0;

  const visiblePassRate =
    visibleTotalCount > 0 ? clamp01(visiblePassedCount / visibleTotalCount) : weightedPassRate;
  const hiddenPassRate =
    hiddenTotalCount > 0 ? clamp01(hiddenPassedCount / hiddenTotalCount) : weightedPassRate;

  // Score execution as primary signal; visible pass-rate dominates for perceived fairness.
  // Coding score policy:
  // - Visible tests: 40%
  // - Hidden tests: 60%
  // If hidden tests are unavailable, visible tests become the full signal.
  const executionScore = clamp01(
    hiddenTotalCount > 0 ? 0.4 * visiblePassRate + 0.6 * hiddenPassRate : visiblePassRate
  );

  try {
    console.log("[evaluateCodeExecution] execution score", {
      status: executionResult?.status,
      passRate,
      weightedPassRate,
      visiblePassRate,
      hiddenPassRate,
      executionScore,
      allTestsPassed,
      passedCount,
      totalCount,
      visibleTotalCount,
      hiddenTotalCount,
      visiblePassedCount,
      hiddenPassedCount,
    });
  } catch (error) {
    console.error("[evaluateCodeExecution] execution logging failed", error?.message || error);
  }

  let verdict;
  if (executionFailureStatuses.has(executionResult?.status)) {
    verdict = "incorrect";
  } else if (allTestsPassed || weightedPassRate === 1) {
    verdict = "correct";
  } else if (weightedPassRate >= 0.4) {
    verdict = "partial";
  } else {
    verdict = "incorrect";
  }

  // Final score is execution-driven; when every testcase passes, always full credit (avoids
  // visible/hidden split bugs). Otherwise blend executionScore with weighted pass rate.
  const combinedNormalized = clamp01(
    allTestsPassed ? 1 : Math.max(executionScore, weightedPassRate)
  );
  const finalScore = Math.max(1, Math.min(10, Math.round(combinedNormalized * 10)));

  console.log("[evaluateCodeExecution] final combined score", {
    combinedNormalized,
    finalScore,
    verdict,
  });

  const failedTests = Array.isArray(executionResult?.results)
    ? executionResult.results
        .map((item, index) => ({ index, ...item }))
        .filter((item) => item?.passed !== true)
        .filter((item) => item?.isHidden !== true)
        .map((item) => ({
          index: item.index,
          input: item.input,
          expectedOutput: item.expectedOutput,
          actualOutput: item.actualOutput,
          error: item.error,
        }))
    : [];

  const executionIssueFeedback = executionFailureStatuses.has(executionResult?.status)
    ? `Execution issue (${executionResult?.status || "EXECUTION_ERROR"}): the submission did not complete sandboxed evaluation successfully.`
    : "";

  const hiddenPart =
    hiddenTotalCount > 0
      ? `Hidden tests passed: ${hiddenPassedCount}/${hiddenTotalCount}.`
      : "Hidden tests: none configured for this problem.";

  const countsLine = `Visible tests passed: ${visiblePassedCount}/${visibleTotalCount}. ${hiddenPart} Score: ${finalScore}/10 (${verdict}).`;

  const feedback = [executionIssueFeedback.trim(), countsLine].filter(Boolean).join(" ");

  logInterviewDsaLlmDebug("code_execution_deterministic_feedback", {
    questionIdTail: String(payload?.metadata?.questionId || "").slice(-12),
    visiblePassedCount,
    visibleTotalCount,
    hiddenPassedCount,
    hiddenTotalCount,
    passedCount,
    totalCount,
    weightedPassRate,
    finalScore,
    verdict,
    executionStatus: executionResult?.status || "",
  });

  return {
    type: "code_execution",
    score: finalScore,
    verdict,
    feedback,
    evaluationTrace: {
      scoringVersion: "code_execution_test_counts_v1",
      verdict,
      correctness: executionScore,
      relevance: undefined,
      execution: {
        status: executionResult?.status || "",
        passedCount,
        failedCount,
        totalCount,
        visiblePassedCount,
        visibleTotalCount,
        hiddenPassedCount,
        hiddenTotalCount,
        executionTime: Number(executionResult?.executionTime) || 0,
        weightedPassRate,
        failedTests,
        userDebugOutput:
          typeof executionResult?.userDebugOutput === "string" ? executionResult.userDebugOutput : "",
      },
    },
  };
};

export default evaluateCodeExecution;
