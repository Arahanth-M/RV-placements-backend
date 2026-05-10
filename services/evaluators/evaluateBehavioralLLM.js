import { evaluateRubricLLM } from "./evaluateRubricLLM.js";

/**
 * Placeholder strategy evaluator.
 * Current phase delegates to rubric/LLM evaluator to preserve output contract.
 */
export const evaluateBehavioralLLM = async (payload) => {
  return evaluateRubricLLM(payload);
};

export default evaluateBehavioralLLM;
