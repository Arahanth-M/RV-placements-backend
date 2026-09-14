import {
  interviewQuestionBankWriteSchema,
  validateQuestionStrategy,
} from "../../validations/interviewQuestionBank.validation.js";

const baseQuestion = {
  questionId: "bank-validation-1",
  title: "Notification service design",
  question: "How would you design a notification service for a small product?",
  companyTags: ["Acme"],
  roleTags: ["Backend Engineer"],
  roundType: "System Design",
  difficulty: "medium",
  evaluationStrategy: "rubric_llm",
  rubric: [
    {
      text: "Identifies the main components",
      category: "architectureCoverage",
      importance: "mustHave",
      expectedAnswerMode: "design",
    },
  ],
};

describe("interview question-bank validation", () => {
  it("accepts a fully targeted rubric question", () => {
    const { value, error } = interviewQuestionBankWriteSchema.validate(baseQuestion, {
      abortEarly: false,
      stripUnknown: true,
    });
    expect(error).toBeUndefined();
    expect(validateQuestionStrategy(value)).toBe("");
  });

  it("rejects roles outside the fixed fresher catalog", () => {
    const { error } = interviewQuestionBankWriteSchema.validate({
      ...baseQuestion,
      roleTags: ["Senior Architect"],
    });
    expect(error).toBeDefined();
  });

  it("requires complete executable metadata for code questions", () => {
    const { value, error } = interviewQuestionBankWriteSchema.validate({
      ...baseQuestion,
      roundType: "DSA",
      evaluationStrategy: "code_execution",
      rubric: [],
      dsaMetadata: { functionSignature: "solve(nums)", supportedLanguages: ["python"] },
      testCases: [{ input: [1], expectedOutput: 1, isHidden: false }],
    });
    expect(error).toBeUndefined();
    expect(validateQuestionStrategy(value)).toMatch(/two visible tests/i);
  });

  it("requires a correct option that exists in MCQ options", () => {
    const { value, error } = interviewQuestionBankWriteSchema.validate({
      ...baseQuestion,
      roundType: "Aptitude",
      evaluationStrategy: "mcq_exact",
      rubric: [],
      mcqMetadata: {
        options: [
          { id: "A", text: "10" },
          { id: "B", text: "20" },
        ],
        correctOptionId: "C",
      },
    });
    expect(error).toBeUndefined();
    expect(validateQuestionStrategy(value)).toMatch(/matching correct option/i);
  });
});
