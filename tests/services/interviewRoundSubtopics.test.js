import InterviewQuestion from "../../models/InterviewQuestion.js";
import { retrieveQuestion } from "../../services/questionRetrievalService.js";
import { buildSubtopicMongoClause } from "../../services/interviewRoundSubtopicsService.js";

const rubric = [
  {
    text: "Explains the concept clearly",
    category: "fundamentals",
    importance: "mustHave",
    expectedAnswerMode: "conceptual",
  },
];

describe("interview round subtopic focus", () => {
  beforeEach(async () => {
    await InterviewQuestion.deleteMany({ questionId: { $regex: "^subtopic-test-" } });
    await InterviewQuestion.create([
      {
        questionId: "subtopic-test-oop",
        title: "OOP basics",
        question: "Explain encapsulation and inheritance.",
        companyTags: ["Acme"],
        roleTags: ["Frontend Engineer"],
        roundType: "CS Fundamentals",
        difficulty: "medium",
        evaluationStrategy: "rubric_llm",
        topics: ["oop"],
        subtopics: ["OOP"],
        rubric,
      },
      {
        questionId: "subtopic-test-os",
        title: "OS basics",
        question: "Explain process vs thread.",
        companyTags: ["Acme"],
        roleTags: ["Frontend Engineer"],
        roundType: "CS Fundamentals",
        difficulty: "medium",
        evaluationStrategy: "rubric_llm",
        topics: ["os"],
        subtopics: ["Operating Systems"],
        rubric,
      },
    ]);
  });

  afterEach(async () => {
    await InterviewQuestion.deleteMany({ questionId: { $regex: "^subtopic-test-" } });
  });

  it("builds a mongo clause for static and bank focus ids", () => {
    expect(buildSubtopicMongoClause("CS Fundamentals", "general")).toBeNull();
    const oop = buildSubtopicMongoClause("CS Fundamentals", "oop");
    expect(oop?.$or?.length).toBeGreaterThan(0);
    const bank = buildSubtopicMongoClause("CS Fundamentals", "bank:OOP");
    expect(bank?.$or?.length).toBeGreaterThan(0);
  });

  it("prefers bank rows matching roundFocus before relaxing", async () => {
    const oop = await retrieveQuestion({
      company: "Acme",
      role: "Frontend Engineer",
      roundType: "CS Fundamentals",
      difficulty: "medium",
      strictTargeting: true,
      roundFocus: "oop",
    });
    expect(oop?.questionId).toBe("subtopic-test-oop");

    const os = await retrieveQuestion({
      company: "Acme",
      role: "Frontend Engineer",
      roundType: "CS Fundamentals",
      difficulty: "medium",
      strictTargeting: true,
      roundFocus: "bank:Operating%20Systems",
    });
    expect(os?.questionId).toBe("subtopic-test-os");
  });
});
