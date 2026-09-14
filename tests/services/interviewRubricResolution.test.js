import { describe, expect, it } from "@jest/globals";
import {
  hasRubricContent,
  resolveExpectedPoints,
} from "../../services/interviewRubricResolution.js";

describe("interviewRubricResolution", () => {
  it("detects when slot rubric points are present", () => {
    expect(hasRubricContent([{ text: "Use PR-AUC for imbalance" }])).toBe(true);
    expect(hasRubricContent([{ text: "   " }])).toBe(false);
  });

  it("falls back to bank rubric when the session slot is empty", () => {
    const resolved = resolveExpectedPoints({
      slotPoints: [],
      bankRubric: [
        {
          text: "Explain delayed labels in fraud detection",
          category: "labeling",
          importance: "mustHave",
          expectedAnswerMode: "conceptual",
        },
      ],
      roundType: "ML/AI Technical",
      expectedAnswerMode: "conceptual",
    });

    expect(resolved).toHaveLength(1);
    expect(resolved[0].text).toContain("delayed labels");
    expect(resolved[0].importance).toBe("mustHave");
  });
});
