import { jest } from "@jest/globals";

const mockGetJSON = jest.fn();
const mockSetJSON = jest.fn();
const mockResearch = jest.fn();

class UnrecoverableError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnrecoverableError";
  }
}

jest.unstable_mockModule("bullmq", () => ({
  Queue: class Queue {
    add() {
      return Promise.resolve({ id: "unused" });
    }
  },
  Worker: class Worker {
    on() {}
  },
  UnrecoverableError,
}));

jest.unstable_mockModule("../../src/utils/redisHelpers.js", () => ({
  getJSON: (...args) => mockGetJSON(...args),
  setJSON: (...args) => mockSetJSON(...args),
}));

const mockOnline = jest.fn();
const mockExperiences = jest.fn();

jest.unstable_mockModule("../../services/companyResearch/researchInterviewQuestions.js", () => ({
  researchInterviewQuestions: (...args) => mockResearch(...args),
  DEFAULT_MAX_SOURCES: 3,
  MAX_SOURCES_CAP: 8,
}));

jest.unstable_mockModule("../../services/companyResearch/researchOnlineQuestions.js", () => ({
  researchOnlineQuestions: (...args) => mockOnline(...args),
}));

jest.unstable_mockModule("../../services/companyResearch/researchInterviewExperiences.js", () => ({
  researchInterviewExperiences: (...args) => mockExperiences(...args),
}));

const { processCompanyResearchJob } = await import("../../workers/companyResearchWorker.js");
const { RESEARCH_JOB_TTL_SECONDS, RESEARCH_JOB_KEY_PREFIX } = await import(
  "../../services/companyResearch/researchJobService.js"
);

const store = new Map();

function seedQueued(jobId) {
  const record = {
    jobId,
    status: "queued",
    companyId: "amazon-id",
    companyName: "Amazon",
    field: "interviewQuestions",
    role: "Software Engineer",
    country: "India",
    createdAt: "2026-09-26T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
  };
  store.set(`${RESEARCH_JOB_KEY_PREFIX}${jobId}`, { value: record, ttl: RESEARCH_JOB_TTL_SECONDS });
  return record;
}

describe("company research worker", () => {
  beforeEach(() => {
    store.clear();
    mockResearch.mockReset();
    mockOnline.mockReset();
    mockExperiences.mockReset();
    mockGetJSON.mockReset();
    mockSetJSON.mockReset();
    mockSetJSON.mockImplementation(async (key, value, ttl) => {
      store.set(key, { value, ttl });
      return true;
    });
    mockGetJSON.mockImplementation(async (key) => store.get(key)?.value ?? null);
  });

  it("moves a queued job to running and then review", async () => {
    const jobId = "11111111-1111-4111-8111-111111111111";
    seedQueued(jobId);
    const result = {
      companyName: "Amazon",
      outcome: "ok",
      items: [{ question: "Implement an LRU cache.", kind: "coding", evidence: "asked" }],
      sources: [{ url: "https://example.com/a", markdown: "full page" }],
    };
    mockResearch.mockImplementation(async () => {
      expect(store.get(`${RESEARCH_JOB_KEY_PREFIX}${jobId}`).value.status).toBe("running");
      return result;
    });

    await expect(
      processCompanyResearchJob({
        data: {
          jobId,
          companyId: "amazon-id",
          companyName: "Amazon",
          field: "interviewQuestions",
          role: "Software Engineer",
          country: "India",
          maxSources: 3,
          searchDepth: "basic",
        },
      })
    ).resolves.toEqual({ jobId, status: "review" });

    const saved = store.get(`${RESEARCH_JOB_KEY_PREFIX}${jobId}`).value;
    expect(saved.status).toBe("review");
    expect(saved.completedAt).toEqual(expect.any(String));
    expect(saved.result.items).toEqual(result.items);
    expect(saved.result.sources[0].markdown).toBeUndefined();
    expect(saved.error).toBeNull();
    expect(store.get(`${RESEARCH_JOB_KEY_PREFIX}${jobId}`).ttl).toBe(RESEARCH_JOB_TTL_SECONDS);
    expect(mockResearch).toHaveBeenCalledTimes(1);
    expect(mockOnline).not.toHaveBeenCalled();
    expect(mockExperiences).not.toHaveBeenCalled();
  });

  it("runs OA research and interview-experience research on their own fields", async () => {
    const oaId = "66666666-6666-4666-8666-666666666666";
    seedQueued(oaId);
    mockOnline.mockResolvedValue({
      companyName: "Amazon",
      outcome: "ok",
      items: [{ question: "Two sum", kind: "coding" }],
      sources: [],
    });
    await expect(
      processCompanyResearchJob({
        data: { jobId: oaId, companyName: "Amazon", field: "onlineQuestions", maxSources: 2 },
      })
    ).resolves.toEqual({ jobId: oaId, status: "review" });
    expect(mockOnline).toHaveBeenCalledWith(
      expect.objectContaining({ companyName: "Amazon", maxSources: 2 })
    );
    expect(mockResearch).not.toHaveBeenCalled();

    const experienceId = "77777777-7777-4777-8777-777777777777";
    seedQueued(experienceId);
    mockExperiences.mockResolvedValue({
      companyName: "Amazon",
      outcome: "ok",
      items: [{ content: "Three rounds.", summarized: false }],
      sources: [],
    });
    await expect(
      processCompanyResearchJob({
        data: {
          jobId: experienceId,
          companyName: "Amazon",
          field: "interviewExperiences",
          maxSources: 1,
        },
      })
    ).resolves.toEqual({ jobId: experienceId, status: "review" });
    expect(mockExperiences).toHaveBeenCalledTimes(1);
    expect(store.get(`${RESEARCH_JOB_KEY_PREFIX}${experienceId}`).value.result.items[0].content).toBe(
      "Three rounds."
    );
  });

  it("stores a safe failure and rethrows without the secret", async () => {
    const jobId = "22222222-2222-4222-8222-222222222222";
    seedQueued(jobId);
    const secret = "sk-live-secret-value";
    const error = new Error(`upstream ${secret}`);
    error.code = "search_failed";
    error.stack = `stack ${secret}`;
    mockResearch.mockRejectedValue(error);

    await expect(processCompanyResearchJob({ data: { jobId, companyName: "Amazon" } })).rejects.toThrow(
      "Research could not be completed."
    );

    const saved = store.get(`${RESEARCH_JOB_KEY_PREFIX}${jobId}`).value;
    expect(saved.status).toBe("failed");
    expect(saved.error).toEqual({
      code: "search_failed",
      message: "Research could not be completed.",
    });
    expect(JSON.stringify(saved)).not.toContain(secret);
  });

  it("does not let a later failure overwrite a review result", async () => {
    const jobId = "33333333-3333-4333-8333-333333333333";
    seedQueued(jobId);
    const key = `${RESEARCH_JOB_KEY_PREFIX}${jobId}`;
    mockResearch.mockImplementation(async () => {
      const current = store.get(key).value;
      store.set(key, {
        value: { ...current, status: "review", result: { items: [{ question: "Keep me" }] }, error: null },
        ttl: RESEARCH_JOB_TTL_SECONDS,
      });
      throw Object.assign(new Error("late failure"), { code: "search_failed" });
    });

    await expect(processCompanyResearchJob({ data: { jobId, companyName: "Amazon" } })).resolves.toEqual({
      jobId,
      status: "review",
    });
    expect(store.get(key).value.status).toBe("review");
    expect(store.get(key).value.result.items[0].question).toBe("Keep me");
  });

  it("does not retry invalid research input", async () => {
    const jobId = "44444444-4444-4444-8444-444444444444";
    seedQueued(jobId);
    mockResearch.mockRejectedValue(Object.assign(new Error("bad input"), { code: "invalid_input" }));

    await expect(processCompanyResearchJob({ data: { jobId, companyName: "Amazon" } })).rejects.toMatchObject({
      name: "UnrecoverableError",
    });
    expect(store.get(`${RESEARCH_JOB_KEY_PREFIX}${jobId}`).value.status).toBe("failed");
  });

  it("does not research or overwrite a published job", async () => {
    const jobId = "55555555-5555-4555-8555-555555555555";
    const key = `${RESEARCH_JOB_KEY_PREFIX}${jobId}`;
    store.set(key, {
      value: {
        ...seedQueued(jobId),
        status: "published",
        result: { items: [{ question: "Already published" }] },
      },
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });

    await expect(processCompanyResearchJob({ data: { jobId, companyName: "Amazon" } })).resolves.toEqual({
      jobId,
      status: "published",
    });
    expect(mockResearch).not.toHaveBeenCalled();
    expect(store.get(key).value.status).toBe("published");
    expect(store.get(key).value.result.items[0].question).toBe("Already published");
  });
});
