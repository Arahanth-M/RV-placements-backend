const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

export const CS_FUNDAMENTALS_MCQ_COUNT = 2;
export const CS_FUNDAMENTALS_THEORY_COUNT = 1;
export const CS_FUNDAMENTALS_TOTAL_QUESTIONS =
  CS_FUNDAMENTALS_MCQ_COUNT + CS_FUNDAMENTALS_THEORY_COUNT;

export const isCsFundamentalsRoundType = (roundType) =>
  toSafeString(roundType).toLowerCase().includes("cs fundamentals");

/**
 * Fixed CS Fundamentals layout: slots 0–1 = MCQ (bank only), slot 2 = theory (bank then LLM).
 * @param {number} questionSlotIndex 0-based index within the round
 * @returns {"mcq"|"theory"|null}
 */
export const resolveCsFundamentalsQuestionKind = (questionSlotIndex) => {
  const idx = Number(questionSlotIndex);
  if (!Number.isFinite(idx) || idx < 0) return null;
  if (idx < CS_FUNDAMENTALS_MCQ_COUNT) return "mcq";
  if (idx < CS_FUNDAMENTALS_TOTAL_QUESTIONS) return "theory";
  return null;
};

export default resolveCsFundamentalsQuestionKind;
