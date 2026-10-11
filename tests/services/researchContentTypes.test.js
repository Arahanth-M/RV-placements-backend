import { jest } from "@jest/globals";

const mockCallLLM = jest.fn();

jest.unstable_mockModule("../../services/llmClient.js", () => ({
  callLLM: (...args) => mockCallLLM(...args),
}));

jest.unstable_mockModule("../../src/utils/redisHelpers.js", () => ({
  getJSON: async () => null,
  setJSON: async () => true,
}));

const { structureOnlineQuestions } = await import(
  "../../services/companyResearch/structureWithGroq.js"
);
const {
  structureInterviewExperiences,
  EXPERIENCE_CHAR_LIMIT,
} = await import("../../services/companyResearch/structureInterviewExperiences.js");
const { buildOnlineAssessmentSearchQueries } = await import(
  "../../services/companyResearch/researchOnlineQuestions.js"
);
const { buildInterviewExperienceSearchQueries } = await import(
  "../../services/companyResearch/researchInterviewExperiences.js"
);

describe("OA and interview experience research", () => {
  beforeEach(() => {
    mockCallLLM.mockReset();
  });

  it("builds OA and interview-experience queries from role and country", () => {
    expect(
      buildOnlineAssessmentSearchQueries({
        companyName: "Acme",
        role: "SDE",
        country: "India",
      })
    ).toEqual([
      '"Acme" "SDE" online assessment questions',
      '"Acme" "SDE" OA questions',
      '"Acme" "SDE" coding test questions',
      '"Acme" "SDE" online assessment India',
    ]);
    expect(
      buildInterviewExperienceSearchQueries({
        companyName: "Acme",
        role: "SDE",
        country: "India",
      })
    ).toEqual([
      '"Acme" "SDE" interview experience',
      '"Acme" "SDE" interview process',
      '"Acme" "SDE" interview experience rounds',
      '"Acme" "SDE" interview experience India',
    ]);
  });

  it("extracts an explicitly reported OA question", async () => {
    mockCallLLM.mockResolvedValue(
      JSON.stringify({
        items: [
          {
            question: "Find two numbers that sum to a target.",
            form: "coding",
            evidence: "The OA asked me to find two numbers that sum to a target.",
          },
        ],
      })
    );

    const result = await structureOnlineQuestions({
      url: "https://example.com/oa",
      title: "Acme OA",
      markdown: "The OA asked me to find two numbers that sum to a target.",
    });

    expect(result.items[0]).toMatchObject({
      question: "Find two numbers that sum to a target.",
      form: "coding",
      sourceUrl: "https://example.com/oa",
    });
    expect(mockCallLLM.mock.calls[0][0][0].content).toContain("online assessment");
    expect(mockCallLLM.mock.calls[0][0][0].content).not.toContain(
      "Extract only interview questions"
    );
  });

  it("keeps a short interview experience without summarizing it", async () => {
    const evidence = "Round 1 was two coding problems.";
    mockCallLLM.mockResolvedValue(
      JSON.stringify({
        items: [{ content: "Round 1 was two coding problems. I cleared it.", evidence }],
      })
    );

    const result = await structureInterviewExperiences({
      url: "https://example.com/exp",
      title: "Acme experience",
      markdown: "Round 1 was two coding problems. I cleared it.",
    });

    expect(result.summarized).toBe(false);
    expect(result.items).toEqual([
      expect.objectContaining({
        content: "Round 1 was two coding problems. I cleared it.",
        summarized: false,
        sourceUrl: "https://example.com/exp",
      }),
    ]);
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
  });

  it("summarizes an interview experience only when the writeup exceeds 12,000 characters", async () => {
    const markerA = "Online round was two coding problems.";
    const markerB = "HR round happened the next day.";
    const markdown = `${markerA}${"a".repeat(EXPERIENCE_CHAR_LIMIT)}${markerB}`;
    expect(markdown.length).toBeGreaterThan(EXPERIENCE_CHAR_LIMIT);

    mockCallLLM.mockImplementation(async (messages) => {
      const system = messages[0].content;
      const user = messages[1].content;
      if (system.startsWith("You summarize")) {
        return JSON.stringify({
          content: "OA coding round, then HR the next day.",
          evidence: "not in the extract",
        });
      }
      if (user.includes(markerA) && user.includes("<<<UNTRUSTED_WEBPAGE>>>")) {
        return JSON.stringify({
          items: [{ content: "A".repeat(7000), evidence: markerA }],
        });
      }
      if (user.includes(markerB)) {
        return JSON.stringify({
          items: [{ content: "B".repeat(7000), evidence: markerB }],
        });
      }
      return JSON.stringify({ items: [] });
    });

    const result = await structureInterviewExperiences({
      url: "https://example.com/long",
      title: "Long experience",
      markdown,
    });

    expect(result.summarized).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].content).toContain("OA coding round");
    expect(result.items[0].content.length).toBeLessThanOrEqual(EXPERIENCE_CHAR_LIMIT);
    expect(result.items[0].summarized).toBe(true);
    expect(result.items[0].evidence).toBe(markerA);
    expect(mockCallLLM.mock.calls.some((call) => call[0][0].content.startsWith("You summarize"))).toBe(
      true
    );
  });

  it("summarizes a page that is longer than 12,000 characters", async () => {
    const marker = "I had one DSA round and was selected.";
    const markdown = `${marker}${"z".repeat(EXPERIENCE_CHAR_LIMIT)}`;
    mockCallLLM.mockImplementation(async (messages) => {
      const system = messages[0].content;
      const user = messages[1].content;
      if (system.startsWith("You summarize")) {
        if (!user.includes(marker)) {
          return JSON.stringify({ content: "", evidence: "" });
        }
        return JSON.stringify({
          content: "One DSA round, then selected.",
          evidence: marker,
        });
      }
      if (user.includes(marker)) {
        return JSON.stringify({
          items: [{ content: "One DSA round. Selected.", evidence: marker }],
        });
      }
      return JSON.stringify({ items: [] });
    });

    const result = await structureInterviewExperiences({
      url: "https://example.com/long-short",
      title: "Long page",
      markdown,
    });

    expect(result.summarized).toBe(true);
    expect(result.items[0]).toMatchObject({
      content: "One DSA round, then selected.",
      summarized: true,
    });
    expect(result.items[0].content.length).toBeLessThanOrEqual(EXPERIENCE_CHAR_LIMIT);
  });
});
