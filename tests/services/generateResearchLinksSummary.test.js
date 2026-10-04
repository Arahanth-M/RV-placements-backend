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

jest.unstable_mockModule("../../models/CompanyStatic.js", () => ({
  default: { findById: jest.fn() },
}));

jest.unstable_mockModule("../../models/CompanyPlatformContent.js", () => ({
  default: { findOne: jest.fn(), updateOne: jest.fn() },
}));

jest.unstable_mockModule("../../services/companyDetailCache.js", () => ({
  invalidateCompanyDetailCache: jest.fn(),
}));

const { generateResearchLinksSummary } = await import(
  "../../services/companyResearch/generateResearchLinksSummary.js"
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
  mockCallLLM.mockResolvedValue(
    JSON.stringify({ summary: "They focus on DSA and core CS fundamentals for SDE roles." })
  );
});

describe("generateResearchLinksSummary", () => {
  it("generates and stores a draft summary on the job", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: {
        jobId: JOB_ID,
        status: "review",
        field: "interviewQuestions",
        companyName: "Acme",
        role: "Software Engineer",
        result: {
          sources: [{ title: "GFG", url: "https://gfg.org/x", tavilySnippet: "arrays" }],
        },
      },
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });

    const result = await generateResearchLinksSummary({ jobId: JOB_ID });
    expect(result.summary).toMatch(/DSA/);
    expect(result.prepRoleKey).toBe("software-engineer");
    const saved = store.get(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`).value;
    expect(saved.linksSummaryDraft.summary).toMatch(/DSA/);
    expect(mockCallLLM).toHaveBeenCalled();
  });

  it("generates a summary after interview questions were published", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: {
        jobId: JOB_ID,
        status: "published",
        companyName: "Acme",
        field: "interviewQuestions",
        role: "Software Engineer",
        result: {
          sources: [{ title: "GFG", url: "https://gfg.org/x", tavilySnippet: "arrays" }],
        },
      },
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });

    const result = await generateResearchLinksSummary({ jobId: JOB_ID });
    expect(result.summary).toMatch(/DSA/);
  });
});
