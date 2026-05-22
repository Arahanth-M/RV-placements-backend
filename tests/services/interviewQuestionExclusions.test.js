import {
  collectSessionQuestionExclusions,
  isInterviewQuestionExcluded,
  mergeInterviewQuestionExclusions,
  normalizeInterviewQuestionText,
} from "../../services/interviewQuestionExclusions.js";

describe("interviewQuestionExclusions", () => {
  it("normalizes question text for comparison", () => {
    expect(normalizeInterviewQuestionText("  Hello World  ")).toBe("hello world");
  });

  it("collects ids and texts from all rounds and currentQuestion", () => {
    const session = {
      currentQuestion: "Live prompt?",
      rounds: [
        {
          questions: [
            { questionId: "cs-001", question: "What is a process?" },
            { question: "What is a thread?", questionId: "" },
          ],
        },
        {
          questions: [{ questionId: "sql-1", question: "Write a JOIN query." }],
        },
      ],
    };
    const out = collectSessionQuestionExclusions(session);
    expect(out.excludedQuestionIds.sort()).toEqual(["cs-001", "sql-1"]);
    expect(out.excludedQuestionTexts).toContain("what is a process?");
    expect(out.excludedQuestionTexts).toContain("what is a thread?");
    expect(out.excludedQuestionTexts).toContain("write a join query.");
    expect(out.excludedQuestionTexts).toContain("live prompt?");
  });

  it("detects excluded id or text", () => {
    const { excludedIdSet, excludedTextSet } = mergeInterviewQuestionExclusions(
      {
        excludedQuestionIds: ["a1"],
        excludedQuestionTexts: ["already asked"],
      },
      {}
    );
    expect(
      isInterviewQuestionExcluded(
        { questionId: "a1", question: "Different text" },
        excludedIdSet,
        excludedTextSet
      )
    ).toBe(true);
    expect(
      isInterviewQuestionExcluded(
        { questionId: "b2", question: "Already asked" },
        excludedIdSet,
        excludedTextSet
      )
    ).toBe(true);
    expect(
      isInterviewQuestionExcluded(
        { questionId: "b2", question: "Fresh question" },
        excludedIdSet,
        excludedTextSet
      )
    ).toBe(false);
  });
});
