import { evaluateCodeExecution } from "../evaluators/evaluateCodeExecution.js";
import { evaluateRubricLLM } from "../evaluators/evaluateRubricLLM.js";
import { evaluateBehavioralLLM } from "../evaluators/evaluateBehavioralLLM.js";

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
  console.log(`[evaluateAnswer] Using evaluator strategy: ${strategy}`);

  switch (strategy) {
    case "code_execution":
      return evaluateCodeExecution(payload);
    case "behavioral_llm":
      return evaluateBehavioralLLM(payload);
    case "rubric_llm":
    default:
      return evaluateRubricLLM(payload);
  }
};

export default evaluateAnswer;