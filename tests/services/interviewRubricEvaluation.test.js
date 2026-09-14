import { jest } from "@jest/globals";

const mockGetEmbedding = jest.fn(async () => {
  throw new Error("embedder unavailable");
});

const mockSafeGetEmbedding = jest.fn(async () => null);

const mockCallLLM = jest.fn(async () =>
  JSON.stringify({
    verdict: "partial",
    confidence: 0.75,
    expectedAnswer:
      "Explain PR-AUC, threshold trade-offs, and business cost for fraud detection.",
    closeness:
      "The answer mentioned PR-AUC but missed threshold and business-cost discussion.",
    improvements: ["Discuss how you would choose an operating threshold."],
    matchedRubricPoints: ["Uses PR-AUC instead of accuracy"],
    missingRubricPoints: ["Explains threshold trade-offs"],
    subscores: {
      correctness: 0.65,
      communication: 0.7,
    },
  })
);

jest.unstable_mockModule("../../utils/embedding.js", () => ({
  getEmbedding: mockGetEmbedding,
  safeGetEmbedding: mockSafeGetEmbedding,
  cosineSimilarity: () => 0,
}));

jest.unstable_mockModule("../../services/llmClient.js", () => ({
  callLLM: mockCallLLM,
}));

const { normalizeExpectedPoints } = await import("../../services/mcp/generateQuestion.js");
const { evaluateAnswer } = await import("../../services/mcp/evaluateAnswer.js");

describe("rubric_llm bank evaluation resilience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns rubric-aligned feedback when embeddings are unavailable", async () => {
    const expectedPoints = normalizeExpectedPoints(
      [
        {
          text: "Uses PR-AUC instead of accuracy for imbalanced fraud data",
          category: "evaluation",
          importance: "mustHave",
          expectedAnswerMode: "conceptual",
        },
        {
          text: "Explains threshold trade-offs between false positives and missed fraud",
          category: "tradeoffs",
          importance: "mustHave",
          expectedAnswerMode: "conceptual",
        },
      ],
      { roundType: "ML/AI Technical", expectedAnswerMode: "conceptual" }
    );

    const result = await evaluateAnswer({
      answer:
        "Accuracy is misleading for fraud because the dataset is imbalanced, so I would use PR-AUC and inspect precision-recall trade-offs.",
      question: "How would you evaluate a payment fraud model beyond accuracy?",
      companyContext: { name: "ExampleCo" },
      llmReasoning: "",
      expectedPoints,
      evaluationStrategy: "rubric_llm",
      questionSource: "retrieved",
    });

    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.feedback).toContain("Expected answer:");
    expect(result.feedback).toContain("PR-AUC");
    expect(result.feedback).not.toContain("neutral score");
    expect(result.feedback).not.toContain("...");
    expect(mockCallLLM).toHaveBeenCalled();
  });
});
