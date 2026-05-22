import { jest } from "@jest/globals";

const mockGetEmbedding = jest.fn(async (text) => {
  const safe = String(text || "").toLowerCase();
  if (safe.includes("binary search")) return [1, 0, 0];
  if (safe.includes("edge cases")) return [0, 1, 0];
  if (safe.includes("time complexity")) return [0, 0, 1];
  if (safe.includes("cache")) return [0.2, 0.8, 0.1];
  return [0.6, 0.6, 0.6];
});

const mockCallLLM = jest.fn(async () =>
  JSON.stringify({
    verdict: "partial",
    confidence: 0.7,
    expectedAnswer:
      "Explain a sound approach, edge cases, and time/space complexity clearly.",
    closeness:
      "The answer mentioned binary search and complexity but edge-case handling was thin.",
    improvements: ["Be explicit about edge cases and tricky inputs."],
    matchedRubricPoints: ["Choose a sound approach"],
    missingRubricPoints: ["Cover edge cases or tricky inputs"],
    subscores: {
      correctness: 0.72,
      communication: 0.68,
    },
  })
);

jest.unstable_mockModule("../../utils/embedding.js", () => ({
  getEmbedding: mockGetEmbedding,
  cosineSimilarity: (a = [], b = []) => {
    const length = Math.max(a.length, b.length, 0);
    if (!length) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let index = 0; index < length; index += 1) {
      const left = Number(a[index] || 0);
      const right = Number(b[index] || 0);
      dot += left * right;
      magA += left * left;
      magB += right * right;
    }
    if (!magA || !magB) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  },
}));

jest.unstable_mockModule("../../services/llmClient.js", () => ({
  callLLM: mockCallLLM,
}));

const { normalizeExpectedPoints, getAdaptiveFollowUp } = await import(
  "../../services/mcp/generateQuestion.js"
);
const { resolveRoundAbout } = await import("../../config/interviewRoundFocus.js");
const { inferQuestionCount, clampQuestionCountForRound } = await import(
  "../../services/interviewEngine.js"
);
const { evaluateAnswer } = await import("../../services/mcp/evaluateAnswer.js");

describe("AI interview scoring helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("normalizes structured rubric points in a backward-compatible way", () => {
    const normalized = normalizeExpectedPoints(
      [
        "Mention time complexity",
        {
          text: "Cover edge cases",
          category: "edgeCases",
          importance: "goodToHave",
          expectedAnswerMode: "code",
        },
      ],
      { roundType: "DSA", expectedAnswerMode: "code" }
    );

    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toMatchObject({
      text: "Mention time complexity",
      category: "coverage",
      importance: "mustHave",
      expectedAnswerMode: "code",
    });
    expect(normalized[1]).toMatchObject({
      text: "Cover edge cases",
      category: "edgeCases",
      importance: "goodToHave",
      expectedAnswerMode: "code",
    });
  });

  it("returns score, verdict, and evaluation trace from the rubric-driven evaluator", async () => {
    const expectedPoints = normalizeExpectedPoints(
      [
        {
          text: "Choose a sound approach",
          category: "algorithmChoice",
          importance: "mustHave",
          expectedAnswerMode: "code",
          embedding: [1, 0, 0],
        },
        {
          text: "Cover edge cases or tricky inputs",
          category: "edgeCases",
          importance: "mustHave",
          expectedAnswerMode: "code",
          embedding: [0, 1, 0],
        },
        {
          text: "Mention time or space complexity",
          category: "complexityAwareness",
          importance: "goodToHave",
          expectedAnswerMode: "code",
          embedding: [0, 0, 1],
        },
      ],
      { roundType: "DSA", expectedAnswerMode: "code" }
    );

    const result = await evaluateAnswer({
      answer:
        "I would use binary search on the sorted array, check edge cases like empty input, and the time complexity is O(log n).",
      question: "How would you solve this array problem and discuss complexity?",
      companyContext: { name: "ExampleCo" },
      llmReasoning: "The candidate described a valid approach with decent reasoning.",
      expectedPoints,
    });

    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.verdict).toBe("partial");
    expect(result.evaluationTrace).toBeTruthy();
    expect(result.evaluationTrace.scoringVersion).toBe("v3-rubric-strict");
    expect(result.evaluationTrace.expectedAnswerMode).toBe("code");
    expect(result.evaluationTrace.subscores.algorithmChoice).toBeGreaterThan(0);
    expect(Array.isArray(result.evaluationTrace.matchedRubricPoints)).toBe(true);
    expect(result.feedback).toContain("Score:");
    expect(result.feedback).toContain("Expected answer:");
    expect(result.feedback).toContain("How close your answer was:");
    expect(result.feedback).toContain("What to improve:");
    expect(mockCallLLM).toHaveBeenCalled();
  });

  it("scores weak low-coverage answers more harshly", async () => {
    const expectedPoints = normalizeExpectedPoints(
      [
        {
          text: "Choose a sound approach",
          category: "algorithmChoice",
          importance: "mustHave",
          expectedAnswerMode: "code",
          embedding: [1, 0, 0],
        },
        {
          text: "Cover edge cases or tricky inputs",
          category: "edgeCases",
          importance: "mustHave",
          expectedAnswerMode: "code",
          embedding: [0, 1, 0],
        },
        {
          text: "Mention time or space complexity",
          category: "complexityAwareness",
          importance: "mustHave",
          expectedAnswerMode: "code",
          embedding: [0, 0, 1],
        },
      ],
      { roundType: "DSA", expectedAnswerMode: "code" }
    );

    const result = await evaluateAnswer({
      answer: "I would probably just loop through it.",
      question: "How would you solve this array problem and discuss complexity?",
      companyContext: { name: "ExampleCo" },
      llmReasoning: "The answer is vague and incomplete.",
      expectedPoints,
    });

    expect(result.score).toBeLessThanOrEqual(4);
    expect(result.verdict).not.toBe("correct");
    expect(result.evaluationTrace.criticalMisses.length).toBeGreaterThan(0);
  });

  it("repair follow-up targets the first critical rubric miss", () => {
    const result = getAdaptiveFollowUp({
      hasPreviousAnswer: true,
      previousScore: 6,
      previousEvaluation: {
        criticalMisses: ["Cover edge cases", "Mention complexity"],
        missingRubricPoints: ["Handle null inputs"],
        recentScores: [6],
      },
      difficulty: "medium",
    });

    expect(result.followUpMode).toBe("repair");
    expect(result.targetRubricGap).toBe("Cover edge cases");
  });

  it("clarify follow-up targets a missing rubric point when score is low", () => {
    const result = getAdaptiveFollowUp({
      hasPreviousAnswer: true,
      previousScore: 3,
      previousEvaluation: {
        criticalMisses: [],
        missingRubricPoints: ["Explain indexing trade-offs"],
        recentScores: [3],
      },
      difficulty: "hard",
    });

    expect(result.followUpMode).toBe("clarify");
    expect(result.targetRubricGap).toBe("Explain indexing trade-offs");
  });

  it("resolveRoundAbout maps SQL focus ids to descriptive topics", () => {
    expect(resolveRoundAbout("SQL", "joins")).toContain("Join");
    expect(resolveRoundAbout("HR", "leadership")).toContain("Leadership");
  });

  it("resolveRoundAbout ignores focus for DSA rounds", () => {
    expect(resolveRoundAbout("DSA", "dp")).toContain("Data structures");
    expect(resolveRoundAbout("DSA", "arrays")).toContain("Data structures");
  });

  it("HR rounds plan for a single question to limit token usage", () => {
    expect(inferQuestionCount("HR")).toBe(1);
    expect(inferQuestionCount("DSA")).toBe(3);
  });

  it("clampQuestionCountForRound keeps HR at one question", () => {
    expect(clampQuestionCountForRound("HR", 3, 0)).toBe(1);
    expect(clampQuestionCountForRound("HR", null, 0)).toBe(1);
    expect(clampQuestionCountForRound("SQL", 99, 0)).toBe(4);
    expect(clampQuestionCountForRound("DSA", 5, 0)).toBe(3);
  });
});
