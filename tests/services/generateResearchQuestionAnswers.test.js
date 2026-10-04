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

const { generateResearchQuestionAnswers } = await import(
  "../../services/companyResearch/generateResearchQuestionAnswers.js"
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

describe("generateResearchQuestionAnswers", () => {
  it("writes generated answers back to the Redis job", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: {
        jobId: JOB_ID,
        status: "review",
        result: {
          items: [
            {
              question: "What is REST?",
              kind: "non_coding",
              evidence: "REST basics",
            },
            {
              question: "Two Sum",
              kind: "coding",
              evidence: "array problem",
            },
          ],
        },
      },
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });

    mockCallLLM
      .mockResolvedValueOnce('{"answer":"REST is an architectural style."}')
      .mockResolvedValueOnce(
        '{"answer":"Use a hash map.","solutions":{"cpp":"// cpp","java":"// java","python":"# py"}}'
      );

    const result = await generateResearchQuestionAnswers({
      jobId: JOB_ID,
      selectedIndexes: [0, 1],
    });

    expect(result.updatedIndexes).toEqual([0, 1]);
    const saved = store.get(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`).value;
    expect(saved.result.items[0].answer).toBe("REST is an architectural style.");
    expect(saved.result.items[1].solutions).toEqual({
      cpp: "// cpp",
      java: "// java",
      python: "# py",
    });
  });
});
