import { evaluateCodeExecution } from "../evaluators/evaluateCodeExecution.js";
import { evaluateRubricLLM } from "../evaluators/evaluateRubricLLM.js";
import { evaluateBehavioralLLM } from "../evaluators/evaluateBehavioralLLM.js";
import { logInterviewDsaLlmDebug } from "../interviewDebugLog.js";

const normalizeStrategy = (value) => {
  const safe = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (safe === "sql_execution") {
    return "rubric_llm";
  }
  if (
    safe === "code_execution" ||
    safe === "rubric_llm" ||
    safe === "behavioral_llm"
  ) {
    return safe;
  }
  // Backward compatibility: existing flow defaults to rubric_llm behavior.
  return "rubric_llm";
};

export const evaluateAnswer = async ({ evaluationStrategy, ...payload }) => {
  const strategy = normalizeStrategy(evaluationStrategy);
  const suppress = Boolean(payload?.suppressLlm);
  const rawCases = Array.isArray(payload?.testCases)
    ? payload.testCases
    : Array.isArray(payload?.metadata?.testCases)
      ? payload.metadata.testCases
      : [];
  const testcaseCount = rawCases.length;
  const rawStrategy = typeof evaluationStrategy === "string" ? evaluationStrategy.trim() : "";

  logInterviewDsaLlmDebug("evaluate_answer_dispatch", {
    strategy,
    evaluationStrategyRaw: rawStrategy,
    suppressLlm: suppress,
    testcaseCount,
    questionIdTail: String(payload?.metadata?.questionId || "").slice(-12),
  });

  if (strategy === "rubric_llm" && testcaseCount > 0) {
    logInterviewDsaLlmDebug("evaluate_answer_rubric_path_despite_testcases", {
      evaluationStrategyRaw: rawStrategy,
      testcaseCount,
      questionIdTail: String(payload?.metadata?.questionId || "").slice(-12),
      hint: "Per-question feedback may use rubric/LLM. Worker should set evaluationStrategy to code_execution when tests exist unless SQL/theoretical.",
    });
  }

  console.log(`[evaluateAnswer] Using evaluator strategy: ${strategy}`);

  switch (strategy) {
    case "code_execution":
      return evaluateCodeExecution(payload);
    case "behavioral_llm":
      return evaluateBehavioralLLM(payload);
    case "rubric_llm":
    default:
      return evaluateRubricLLM({
        ...payload,
        suppressLlm: Boolean(payload?.suppressLlm),
        questionSource: payload?.questionSource ?? payload?.metadata?.questionSource ?? "",
      });
  }
};

export default evaluateAnswer;