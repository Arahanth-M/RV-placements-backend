import {
  CS_FUNDAMENTALS_MCQ_COUNT,
  CS_FUNDAMENTALS_THEORY_COUNT,
  CS_FUNDAMENTALS_TOTAL_QUESTIONS,
  isCsFundamentalsRoundType,
  resolveCsFundamentalsQuestionKind,
} from "../../utils/csFundamentalsRoundPlan.js";

describe("csFundamentalsRoundPlan", () => {
  test("CS Fundamentals round is always 2 MCQ + 1 theory", () => {
    expect(CS_FUNDAMENTALS_TOTAL_QUESTIONS).toBe(3);
    expect(CS_FUNDAMENTALS_MCQ_COUNT).toBe(2);
    expect(CS_FUNDAMENTALS_THEORY_COUNT).toBe(1);
  });

  test("resolveCsFundamentalsQuestionKind maps slot indices", () => {
    expect(resolveCsFundamentalsQuestionKind(0)).toBe("mcq");
    expect(resolveCsFundamentalsQuestionKind(1)).toBe("mcq");
    expect(resolveCsFundamentalsQuestionKind(2)).toBe("theory");
    expect(resolveCsFundamentalsQuestionKind(3)).toBeNull();
  });

  test("isCsFundamentalsRoundType matches round label", () => {
    expect(isCsFundamentalsRoundType("CS Fundamentals")).toBe(true);
    expect(isCsFundamentalsRoundType("DSA")).toBe(false);
  });
});
