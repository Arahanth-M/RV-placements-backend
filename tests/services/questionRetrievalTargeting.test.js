import InterviewQuestion from "../../models/InterviewQuestion.js";
import { retrieveQuestion } from "../../services/questionRetrievalService.js";

const rubric = [
  {
    text: "Explains the main components and trade-offs",
    category: "architectureCoverage",
    importance: "mustHave",
    expectedAnswerMode: "design",
  },
];

describe("platform question-bank targeting", () => {
  beforeEach(async () => {
    await InterviewQuestion.deleteMany({
      questionId: { $regex: "^targeting-test-" },
    });
    await InterviewQuestion.create([
      {
        questionId: "targeting-test-backend",
        title: "Backend design",
        question: "Design a fresher-scale notification service.",
        companyTags: ["Acme"],
        roleTags: ["Backend Engineer"],
        roundType: "System Design",
        difficulty: "medium",
        evaluationStrategy: "rubric_llm",
        rubric,
        sourceMetadata: { verified: true, qualityScore: 0.8 },
      },
      {
        questionId: "targeting-test-hardware",
        title: "Hardware design",
        question: "Explain a simple hardware validation plan.",
        companyTags: ["Acme"],
        roleTags: ["VLSI/Hardware Engineer"],
        roundType: "System Design",
        difficulty: "medium",
        evaluationStrategy: "rubric_llm",
        rubric,
        sourceMetadata: { verified: true, qualityScore: 1 },
      },
    ]);
  });

  afterEach(async () => {
    await InterviewQuestion.deleteMany({
      questionId: { $regex: "^targeting-test-" },
    });
  });

  it("requires company, role, round type, and difficulty in strict platform mode", async () => {
    const result = await retrieveQuestion({
      company: "acme",
      role: "Backend Engineer",
      roundType: "System Design",
      difficulty: "medium",
      strictTargeting: true,
    });

    expect(result?.questionId).toBe("targeting-test-backend");

    const miss = await retrieveQuestion({
      company: "Acme",
      role: "AI/ML Engineer",
      roundType: "System Design",
      difficulty: "medium",
      strictTargeting: true,
    });
    expect(miss).toBeNull();
  });
});
