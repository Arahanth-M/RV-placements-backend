import { jest } from "@jest/globals";

const mockGetJSON = jest.fn();
const mockSetJSON = jest.fn();
const mockFindById = jest.fn();
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();
const mockInvalidate = jest.fn();

jest.unstable_mockModule("../../src/utils/redisHelpers.js", () => ({
  getJSON: (...args) => mockGetJSON(...args),
  setJSON: (...args) => mockSetJSON(...args),
  addToSet: async () => true,
  getSetMembers: async () => [],
}));

jest.unstable_mockModule("../../models/CompanyStatic.js", () => ({
  default: { findById: (...args) => mockFindById(...args) },
}));

jest.unstable_mockModule("../../models/CompanyPlatformContent.js", () => ({
  default: {
    findOne: (...args) => mockFindOne(...args),
    updateOne: (...args) => mockUpdateOne(...args),
  },
}));

jest.unstable_mockModule("../../services/companyDetailCache.js", () => ({
  invalidateCompanyDetailCache: (...args) => mockInvalidate(...args),
}));

const { publishResearchSources } = await import(
  "../../services/companyResearch/publishResearchSources.js"
);
const { normalizeSourceUrl } = await import("../../services/companyResearch/urlNormalize.js");
const { RESEARCH_JOB_KEY_PREFIX, RESEARCH_JOB_TTL_SECONDS } = await import(
  "../../services/companyResearch/researchJobService.js"
);

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "507f1f77bcf86cd799439011";
const store = new Map();

function leanOf(value) {
  return {
    select() {
      return this;
    },
    lean: async () => value,
  };
}

const JOB_SOURCES = [
  {
    url: "https://example.com/a",
    title: "Example A",
    tavilySnippet: "Snippet A",
    tavilyScore: 0.91,
  },
  {
    url: "https://example.com/b",
    title: "Example B",
    tavilySnippet: "Snippet B",
    tavilyScore: 0.82,
  },
];

function reviewJob(overrides = {}) {
  return {
    jobId: JOB_ID,
    status: "review",
    companyId: COMPANY_ID,
    field: "interviewQuestions",
    role: "Software Engineer",
    result: { sources: JOB_SOURCES, items: [] },
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  mockGetJSON.mockImplementation(async (key) => store.get(key)?.value ?? null);
  mockSetJSON.mockImplementation(async (key, value, ttl) => {
    store.set(key, { value, ttl });
    return true;
  });
  mockFindById.mockImplementation(() => leanOf({ _id: COMPANY_ID }));
  mockFindOne.mockImplementation(() => leanOf({ researchSources: [] }));
  mockUpdateOne.mockResolvedValue({ acknowledged: true });
  mockInvalidate.mockResolvedValue(undefined);
});

describe("publishResearchSources", () => {
  it("inserts all unique sources and keeps the job in review", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: reviewJob(),
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });

    const result = await publishResearchSources({ jobId: JOB_ID });
    expect(result).toMatchObject({
      jobId: JOB_ID,
      status: "review",
      prepRoleKey: "software-engineer",
      insertedSourceCount: 2,
      duplicateSourceCount: 0,
      summaryPersisted: false,
    });
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);
    const sources = mockUpdateOne.mock.calls[0][1].$push.researchSources.$each;
    expect(sources.map((row) => row.url)).toEqual([
      normalizeSourceUrl(JOB_SOURCES[0].url),
      normalizeSourceUrl(JOB_SOURCES[1].url),
    ]);
    expect(sources.every((row) => row.prepRoleKey === "software-engineer")).toBe(true);
    expect(store.get(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`).value.status).toBe("review");
    expect(store.get(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`).value.sourcesPublication).toBeDefined();
    expect(mockInvalidate).toHaveBeenCalledWith(COMPANY_ID);
  });

  it("approves links after interview questions were published", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: reviewJob({ status: "published", publication: { insertedCount: 2, duplicateCount: 0 } }),
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });

    const result = await publishResearchSources({ jobId: JOB_ID });
    expect(result).toMatchObject({
      jobId: JOB_ID,
      status: "published",
      insertedSourceCount: 2,
      duplicateSourceCount: 0,
    });
    expect(store.get(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`).value.sourcesPublication).toBeDefined();
  });

  it("skips duplicate URLs already in production", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: reviewJob(),
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });
    mockFindOne.mockImplementation(() =>
      leanOf({
        researchSources: [
          {
            prepRoleKey: "software-engineer",
            url: normalizeSourceUrl(JOB_SOURCES[0].url),
            title: "Existing",
          },
        ],
      })
    );

    const result = await publishResearchSources({ jobId: JOB_ID });
    expect(result).toMatchObject({
      insertedSourceCount: 1,
      duplicateSourceCount: 1,
    });
    expect(mockUpdateOne.mock.calls[0][1].$push.researchSources.$each).toHaveLength(1);
  });
});
