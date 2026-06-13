import {
  buildQuestionDisplayFromSlot,
  buildResolvedFieldsForQuestionSlot,
  slotNeedsBankQuestionLookup,
} from "../../utils/interviewQuestionSlotSnapshot.js";

describe("interviewQuestionSlotSnapshot", () => {
  const codeSlot = {
    questionId: "gap-leetcode-two-sum",
    questionUrl: "https://leetcode.com/problems/two-sum/",
    evaluationStrategy: "code_execution",
    sourceType: "retrieved",
    resolvedCodeTestCases: [{ input: [1, 2], expectedOutput: 3, isHidden: false }],
    resolvedDsaMetadata: { functionSignature: "def twoSum(nums, target):" },
    resolvedTopics: ["Array", "Hash Table"],
    resolvedSubtopics: ["Two pointers"],
    resolvedCompanyTags: ["Google"],
    resolvedComplexity: { time: "O(n)", space: "O(n)" },
  };

  test("buildResolvedFieldsForQuestionSlot copies snapshot fields from gen payload", () => {
    expect(
      buildResolvedFieldsForQuestionSlot({
        resolvedCodeTestCases: [{ input: 1 }],
        resolvedDsaMetadata: { functionSignature: "f()" },
        resolvedTopics: ["DSA"],
        resolvedSubtopics: [],
        resolvedCompanyTags: ["Amazon"],
        resolvedComplexity: { time: "O(n)" },
      })
    ).toEqual({
      resolvedCodeTestCases: [{ input: 1 }],
      resolvedDsaMetadata: { functionSignature: "f()" },
      resolvedTopics: ["DSA"],
      resolvedSubtopics: [],
      resolvedCompanyTags: ["Amazon"],
      resolvedComplexity: { time: "O(n)" },
    });
  });

  test("buildQuestionDisplayFromSlot maps slot fields to display doc shape", () => {
    expect(buildQuestionDisplayFromSlot(codeSlot)).toEqual({
      questionId: "gap-leetcode-two-sum",
      question: "",
      url: "https://leetcode.com/problems/two-sum/",
      testCases: [{ input: [1, 2], expectedOutput: 3, isHidden: false }],
      dsaMetadata: { functionSignature: "def twoSum(nums, target):" },
      topics: ["Array", "Hash Table"],
      subtopics: ["Two pointers"],
      companyTags: ["Google"],
      complexity: { time: "O(n)", space: "O(n)" },
      mcq: null,
    });
  });

  test("slotNeedsBankQuestionLookup skips bank for complete DSA snapshot", () => {
    expect(slotNeedsBankQuestionLookup(codeSlot, "DSA")).toBe(false);
  });

  test("slotNeedsBankQuestionLookup requires bank when coding snapshot is incomplete", () => {
    expect(
      slotNeedsBankQuestionLookup(
        {
          questionId: "x",
          evaluationStrategy: "code_execution",
          resolvedCodeTestCases: [],
        },
        "DSA"
      )
    ).toBe(true);
  });

  test("slotNeedsBankQuestionLookup skips bank for LLM-generated questions", () => {
    expect(
      slotNeedsBankQuestionLookup(
        { sourceType: "generated", question: "Explain polymorphism.", evaluationStrategy: "rubric_llm" },
        "CS Fundamentals"
      )
    ).toBe(false);
  });

  test("slotNeedsBankQuestionLookup skips bank for non-DSA snapshot with topics", () => {
    expect(
      slotNeedsBankQuestionLookup(
        {
          questionId: "hr-1",
          sourceType: "retrieved",
          evaluationStrategy: "behavioral_llm",
          resolvedTopics: [],
        },
        "HR"
      )
    ).toBe(false);
  });

  test("slotNeedsBankQuestionLookup skips bank for MCQ snapshot", () => {
    expect(
      slotNeedsBankQuestionLookup(
        {
          questionId: "Q040",
          evaluationStrategy: "mcq_exact",
          resolvedMcqMetadata: {
            options: [
              { id: "A", text: "One" },
              { id: "B", text: "Two" },
            ],
            correctOptionId: "A",
          },
        },
        "CS Fundamentals"
      )
    ).toBe(false);
  });

  test("buildResolvedFieldsForQuestionSlot copies MCQ metadata", () => {
    expect(
      buildResolvedFieldsForQuestionSlot({
        resolvedMcqMetadata: { options: [{ id: "A", text: "One" }], correctOptionId: "A" },
      })
    ).toEqual({
      resolvedMcqMetadata: { options: [{ id: "A", text: "One" }], correctOptionId: "A" },
    });
  });
});
