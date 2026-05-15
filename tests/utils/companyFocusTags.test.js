import {
  getCompanyFocusTags,
  getMustDoTopics,
  isLongFormTopic,
  normalizeShortTopicChip,
} from "../../utils/companyFocusTags.js";

describe("companyFocusTags", () => {
  it("uses short must-do topics as chips", () => {
    expect(
      getCompanyFocusTags({
        Must_Do_Topics: ["DSA", "Operating Systems", "Puzzles"],
      })
    ).toEqual(["DSA", "Operating Systems", "Puzzles"]);
  });

  it("extracts keywords from long sentence must-do topics", () => {
    const tags = getCompanyFocusTags({
      Must_Do_Topics: [
        "Practice arrays and dynamic programming from leetcode medium problems daily.",
      ],
    });
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.length).toBeLessThanOrEqual(3);
    expect(tags.some((t) => /array|dynamic/i.test(t))).toBe(true);
    expect(tags.every((t) => t.length <= 60)).toBe(true);
  });

  it("mixes short chips and keyword labels from long topics", () => {
    const tags = getCompanyFocusTags({
      Must_Do_Topics: [
        "Aptitude",
        "They focus heavily on dbms normalization, indexing, and sql joins in technical rounds.",
      ],
    });
    expect(tags[0]).toBe("Aptitude");
    expect(tags.some((t) => /dbms|sql|indexing/i.test(t))).toBe(true);
  });

  it("returns at most three tags", () => {
    expect(
      getCompanyFocusTags({
        Must_Do_Topics: ["DSA", "OS", "DBMS", "Networks", "Java"],
      }).length
    ).toBe(3);
  });

  it("returns General when must-do is empty", () => {
    expect(getCompanyFocusTags({ Must_Do_Topics: [] })).toEqual(["General"]);
    expect(getCompanyFocusTags({})).toEqual(["General"]);
  });

  it("reads must_do_topics snake_case field", () => {
    expect(
      getCompanyFocusTags({ must_do_topics: ["Communication", "Aptitude"] })
    ).toEqual(["Communication", "Aptitude"]);
  });

  it("isLongFormTopic detects sentences", () => {
    expect(isLongFormTopic("DSA")).toBe(false);
    expect(isLongFormTopic("Practice dynamic programming daily.")).toBe(true);
    expect(
      isLongFormTopic(
        "This is a very long topic that exceeds the short chip character limit significantly"
      )
    ).toBe(true);
  });

  it("normalizeShortTopicChip preserves acronyms", () => {
    expect(normalizeShortTopicChip("DSA")).toBe("DSA");
    expect(normalizeShortTopicChip("core cs")).toBe("Core Cs");
  });

  it("getMustDoTopics dedupes case-insensitively", () => {
    expect(
      getMustDoTopics({
        Must_Do_Topics: ["dsa", "DSA", "  OS  "],
      })
    ).toEqual(["dsa", "OS"]);
  });
});
