import { buildInterviewTips, normalizeExpectationTopics } from "../../utils/interviewTips.js";

describe("buildInterviewTips", () => {
  test("uses company must-do topics instead of generic interview advice", () => {
    const result = buildInterviewTips({
      roundType: "DSA",
      difficulty: "medium",
      currentQuestion: "Design a rate limiter",
      companyName: "PhonePe",
      currentQuestionIndex: 0,
      mustDoTopics: ["Dynamic Programming", "System Design", "SQL"],
      desiredCount: 6,
    });

    expect(result.companySpecific).toBe(true);
    expect(result.tips.length).toBeGreaterThan(0);
    expect(result.tips.length).toBeLessThanOrEqual(6);
    expect(result.tips.join(" ")).toMatch(/PhonePe/);
    expect(result.tips.join(" ")).toMatch(/Dynamic Programming/);
    expect(result.tips.join(" ")).not.toMatch(/brute-force/i);
  });

  test("puts a must-do topic that matches the question first", () => {
    const result = buildInterviewTips({
      roundType: "DSA",
      companyName: "Razorpay",
      currentQuestion: "Explain database indexing and when an index helps.",
      mustDoTopics: ["Operating Systems", "Indexing"],
    });

    expect(result.companySpecific).toBe(true);
    expect(result.tips[0]).toMatch(/^Razorpay expects candidates to be ready on Indexing/);
  });

  test("falls back to general tips when the company has no must-do topics", () => {
    const result = buildInterviewTips({
      roundType: "DSA",
      difficulty: "easy",
      companyName: "Acme",
      currentQuestion: "Reverse a linked list",
      mustDoTopics: [],
    });

    expect(result.companySpecific).toBe(false);
    expect(result.tips.length).toBeGreaterThanOrEqual(4);
    expect(result.tips.some((tip) => /brute-force|data structure|complexity/i.test(tip))).toBe(
      true
    );
  });

  test("normalizes string and object must-do topics", () => {
    expect(
      normalizeExpectationTopics([
        "  Arrays ",
        { topic: "SQL" },
        "arrays",
        { topic: "  " },
        null,
      ])
    ).toEqual(["Arrays", "SQL"]);
  });
});
