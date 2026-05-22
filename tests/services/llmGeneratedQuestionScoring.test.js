import {
  applyLlmGeneratedDeterministicOverrides,
  applyLlmGeneratedVerdictAndFactualityCaps,
  clampLlmSubscoresForGenerated,
  deriveStrictVerdictForGenerated,
  isLlmGeneratedQuestionSource,
} from "../../services/evaluators/llmGeneratedQuestionScoring.js";

describe("llmGeneratedQuestionScoring", () => {
  it("identifies generated source only", () => {
    expect(isLlmGeneratedQuestionSource("generated")).toBe(true);
    expect(isLlmGeneratedQuestionSource("retrieved")).toBe(false);
    expect(isLlmGeneratedQuestionSource("")).toBe(false);
  });

  it("caps incorrect and factually wrong scores", () => {
    const capped = applyLlmGeneratedVerdictAndFactualityCaps("incorrect", 0.85, {
      factuallyCorrect: false,
    });
    expect(capped.verdict).toBe("incorrect");
    expect(capped.finalScore).toBeLessThanOrEqual(3);
  });

  it("caps weak partial scores", () => {
    const capped = applyLlmGeneratedVerdictAndFactualityCaps("partial", 0.72, {
      factuallyCorrect: true,
    });
    expect(capped.finalScore).toBeLessThanOrEqual(5);
  });

  it("lowers score when must-have rubric coverage is poor", () => {
    const score = applyLlmGeneratedDeterministicOverrides(
      { mustHaveCoverage: 0.2, coverage: 0.1 },
      0.75,
      0.8
    );
    expect(score).toBeLessThanOrEqual(0.35);
  });

  it("clamps optimistic LLM subscores", () => {
    expect(clampLlmSubscoresForGenerated({ correctness: 0.9, communication: 0.85 })).toEqual({
      correctness: 0.3,
      communication: 0.3,
    });
  });

  it("keeps incorrect verdict for generated strict path", () => {
    expect(
      deriveStrictVerdictForGenerated({
        llmVerdict: "incorrect",
        relevance: 0.6,
        mustHaveCoverage: 0.2,
        criticalMisses: ["a", "b"],
        normalizedScore: 0.5,
        wordCount: 40,
        factuallyCorrect: false,
      })
    ).toBe("incorrect");
  });
});
