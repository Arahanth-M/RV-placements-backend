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
      .mockResolvedValueOnce('{"answer":"Use a hash map."}')
      .mockResolvedValueOnce('{"code":"// cpp"}')
      .mockResolvedValueOnce('{"code":"// java"}')
      .mockResolvedValueOnce('{"code":"# py"}');

    const result = await generateResearchQuestionAnswers({
      jobId: JOB_ID,
      selectedIndexes: [0, 1],
    });

    expect(result.updatedIndexes).toEqual([0, 1]);
    expect(mockCallLLM.mock.calls[0][1]).toMatchObject({
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: 3072,
      response_format: {
        type: "json_schema",
        json_schema: { name: "written_answer", strict: true },
      },
    });
    expect(mockCallLLM.mock.calls[0][0][0].content).toContain("escape newlines as \\n");
    expect(mockCallLLM.mock.calls[0][0][0].content).not.toContain("real newline");
    expect(mockCallLLM.mock.calls[1][1].max_completion_tokens).toBe(3072);
    expect(mockCallLLM.mock.calls[1][0][1].content).not.toContain("Provide C++, Java, and Python");
    expect(mockCallLLM.mock.calls[2][1]).toMatchObject({
      max_completion_tokens: 8192,
      response_format: {
        type: "json_schema",
        json_schema: { name: "source_code", strict: true },
      },
    });
    expect(mockCallLLM.mock.calls[2][0][1].content).toContain("complete C++");
    expect(mockCallLLM.mock.calls[2][0][1].content).not.toContain("Java");
    expect(mockCallLLM.mock.calls[3][0][1].content).toContain("complete Java");
    expect(mockCallLLM.mock.calls[4][0][1].content).toContain("complete Python");
    const saved = store.get(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`).value;
    expect(saved.result.items[0].answer).toBe("REST is an architectural style.");
    expect(saved.result.items[1].solutions).toEqual({
      cpp: "// cpp",
      java: "// java",
      python: "# py",
    });
  });

  it("clips long source context and retries once when the model returns invalid JSON", async () => {
    const evidence = "source ".repeat(4000);
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: {
        jobId: JOB_ID,
        status: "review",
        result: {
          items: [{ question: "What is a hash map?", kind: "non_coding", evidence }],
        },
      },
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });

    mockCallLLM
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"answer":"A hash map stores keys with values."}');

    const result = await generateResearchQuestionAnswers({
      jobId: JOB_ID,
      selectedIndexes: [0],
    });

    expect(result.items[0].answer).toBe("A hash map stores keys with values.");
    expect(mockCallLLM).toHaveBeenCalledTimes(2);
    const prompt = mockCallLLM.mock.calls[0][0][1].content;
    expect(prompt.length).toBeLessThan(evidence.length);
    expect(prompt).toContain("Context from source:");
  });

  it("rewrites one answer and keeps answers saved on other questions while it runs", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: {
        jobId: JOB_ID,
        status: "review",
        result: {
          items: [
            { question: "What is REST?", kind: "non_coding", answer: "A weak first draft." },
            { question: "Two Sum", kind: "coding", answer: "Original two sum answer." },
          ],
        },
      },
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });

    mockCallLLM.mockImplementation(async () => {
      const key = `${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`;
      const stored = store.get(key);
      stored.value = {
        ...stored.value,
        result: {
          ...stored.value.result,
          items: stored.value.result.items.map((item, index) =>
            index === 1 ? { ...item, answer: "Kept sibling." } : item
          ),
        },
      };
      return '{"answer":"REST uses resources and HTTP methods."}';
    });

    const result = await generateResearchQuestionAnswers({
      jobId: JOB_ID,
      selectedIndexes: [0],
      regenerate: true,
    });

    expect(result.updatedIndexes).toEqual([0]);
    expect(result.items[0].answer).toBe("REST uses resources and HTTP methods.");
    const prompt = mockCallLLM.mock.calls[0][0][1].content;
    expect(prompt).toContain("Rewrite the previous answer");
    expect(prompt).toContain("A weak first draft.");
    expect(mockCallLLM.mock.calls[0][1].temperature).toBe(0.4);
    const saved = store.get(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`).value;
    expect(saved.result.items[0].answer).toBe("REST uses resources and HTTP methods.");
    expect(saved.result.items[1].answer).toBe("Kept sibling.");
  });

  it("rewrites one coding language and keeps the other languages", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: {
        jobId: JOB_ID,
        status: "review",
        result: {
          items: [
            {
              question: "Implement an LRU cache",
              kind: "coding",
              answer: "Hash map plus list.",
              solutions: {
                cpp: "int oldCpp() { return 1; }",
                java: "int oldJava() { return 1; }",
                python: "def old_python():\n    return 1",
              },
            },
          ],
        },
      },
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });
    mockCallLLM.mockResolvedValue('{"code":"def rewritten_python():\\n    return 2"}');

    const result = await generateResearchQuestionAnswers({
      jobId: JOB_ID,
      selectedIndexes: [0],
      regenerate: true,
      language: "python",
    });

    expect(result.items[0].solutions).toEqual({
      cpp: "int oldCpp() { return 1; }",
      java: "int oldJava() { return 1; }",
      python: "def rewritten_python():\n    return 2",
    });
    expect(result.items[0].answer).toBe("Hash map plus list.");
    const prompt = mockCallLLM.mock.calls[0][0][1].content;
    expect(prompt).toContain("Rewrite only the Python solution");
    expect(prompt).toContain("def old_python()");
    expect(prompt).not.toContain("oldCpp");
  });
});
