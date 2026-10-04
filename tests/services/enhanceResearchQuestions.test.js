import { jest } from "@jest/globals";

const mockGetJSON = jest.fn();
const mockSetJSON = jest.fn();
const mockCallLLM = jest.fn();

jest.unstable_mockModule("../../src/utils/redisHelpers.js", () => ({
  getJSON: (...args) => mockGetJSON(...args),
  setJSON: (...args) => mockSetJSON(...args),
  addToSet: async () => true,
  getSetMembers: async () => [],
}));

jest.unstable_mockModule("../../services/llmClient.js", () => ({
  callLLM: (...args) => mockCallLLM(...args),
}));

jest.unstable_mockModule("../../services/companyResearch/publishResearchInterviewQuestions.js", () => {
  class PublishResearchError extends Error {
    constructor(code) {
      super(code);
      this.name = "PublishResearchError";
      this.code = code;
      this.status = code === "invalid_selection" ? 400 : 409;
    }
  }
  function parseSelectedIndexes(selectedIndexes) {
    if (!Array.isArray(selectedIndexes) || selectedIndexes.length === 0) {
      throw new PublishResearchError("invalid_selection");
    }
    const seen = new Set();
    const indexes = [];
    for (const value of selectedIndexes) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || seen.has(value)) {
        throw new PublishResearchError("invalid_selection");
      }
      seen.add(value);
      indexes.push(value);
    }
    return indexes;
  }
  return { PublishResearchError, parseSelectedIndexes };
});

const { enhanceResearchQuestions } = await import(
  "../../services/companyResearch/enhanceResearchQuestions.js"
);
const { RESEARCH_JOB_KEY_PREFIX, RESEARCH_JOB_TTL_SECONDS } = await import(
  "../../services/companyResearch/researchJobService.js"
);

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const store = new Map();

beforeEach(() => {
  store.clear();
  mockGetJSON.mockImplementation(async (key) => store.get(key)?.value ?? null);
  mockSetJSON.mockImplementation(async (key, value, ttl) => {
    store.set(key, { value, ttl });
    return true;
  });
  mockCallLLM.mockReset();
});

describe("enhanceResearchQuestions", () => {
  it("turns a problem heading into a full statement and keeps the original", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: {
        jobId: JOB_ID,
        status: "review",
        field: "interviewQuestions",
        companyName: "Amazon",
        role: "SDE",
        result: {
          items: [
            {
              question: "LRU Cache",
              kind: "coding",
              evidence: "I was asked to implement an LRU cache.",
              answer: "Use a hash map.",
            },
            {
              question: "Explain the difference between a process and a thread.",
              kind: "non_coding",
              evidence: "OS round",
            },
          ],
        },
      },
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });

    mockCallLLM.mockResolvedValue(
      JSON.stringify({
        items: [
          {
            index: 0,
            question:
              "Design a data structure that implements an LRU cache with get and put in O(1) time.",
          },
          {
            index: 1,
            question: "Explain the difference between a process and a thread.",
          },
        ],
      })
    );

    const result = await enhanceResearchQuestions({
      jobId: JOB_ID,
      selectedIndexes: [0, 1],
    });

    expect(result.updatedIndexes).toEqual([0]);
    const saved = store.get(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`).value.result.items;
    expect(saved[0].question).toBe(
      "Design a data structure that implements an LRU cache with get and put in O(1) time."
    );
    expect(saved[0].sourceQuestion).toBe("LRU Cache");
    expect(saved[0].answer).toBe("Use a hash map.");
    expect(saved[1].question).toBe("Explain the difference between a process and a thread.");
    expect(saved[1].sourceQuestion).toBeUndefined();
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockCallLLM.mock.calls[0][0])).toContain("LRU Cache");
  });

  it("keeps the first original heading when a question is enhanced again", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: {
        jobId: JOB_ID,
        status: "review",
        field: "interviewQuestions",
        companyName: "Amazon",
        role: "SDE",
        result: {
          items: [
            {
              question: "Design an LRU cache with O(1) get and put.",
              sourceQuestion: "LRU Cache",
              kind: "coding",
            },
          ],
        },
      },
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });
    mockCallLLM.mockResolvedValue(
      JSON.stringify({
        items: [
          {
            index: 0,
            question:
              "Implement an LRU cache that supports get(key) and put(key, value) in O(1) time.",
          },
        ],
      })
    );

    await enhanceResearchQuestions({ jobId: JOB_ID, selectedIndexes: [0] });
    const saved = store.get(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`).value.result.items[0];
    expect(saved.sourceQuestion).toBe("LRU Cache");
    expect(saved.question).toMatch(/get\(key\)/);
  });
});
