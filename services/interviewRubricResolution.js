import { normalizeExpectedPoints } from "./mcp/generateQuestion.js";

export const BANK_QUESTION_EVAL_SELECT =
  "questionId testCases dsaMetadata sqlMetadata evaluationStrategy roundType rubric";

const toSafeString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

export const hasRubricContent = (points = []) =>
  (Array.isArray(points) ? points : []).some((point) => toSafeString(point?.text));

export const resolveExpectedPoints = ({
  slotPoints = [],
  bankRubric = [],
  roundType = "",
  expectedAnswerMode = "",
} = {}) => {
  if (hasRubricContent(slotPoints)) {
    return Array.isArray(slotPoints) ? slotPoints : [];
  }
  if (!Array.isArray(bankRubric) || bankRubric.length === 0) {
    return [];
  }
  return normalizeExpectedPoints(bankRubric, {
    roundType,
    expectedAnswerMode,
  });
};

export default resolveExpectedPoints;
