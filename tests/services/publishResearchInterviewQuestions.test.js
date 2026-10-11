import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

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

jest.unstable_mockModule("../../middleware/authJWT.js", () => ({
  default: (req, _res, next) => {
    req.user = {
      isAdminSession: true,
      isSuperAdmin: true,
      adminScope: "platform",
      username: "Ada",
      email: "ada@example.com",
    };
    next();
  },
}));

jest.unstable_mockModule("../../middleware/authorize.js", () => ({
  authorize: () => (_req, _res, next) => next(),
  default: () => (_req, _res, next) => next(),
}));

jest.unstable_mockModule("../../middleware/requireAdmin.js", () => ({
  default: (_req, _res, next) => next(),
}));

jest.unstable_mockModule("../../middleware/requirePlatformAdmin.js", () => ({
  default: (_req, _res, next) => next(),
}));

const { publishResearchInterviewQuestions, PublishResearchError } = await import(
  "../../services/companyResearch/publishResearchInterviewQuestions.js"
);
const { normalizeSourceUrl } = await import("../../services/companyResearch/urlNormalize.js");
const { default: companyResearchRouter } = await import("../../routes/companyResearchRoutes.js");
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
    extractionStatus: "extracted",
    structureStatus: "structured",
  },
  {
    url: "https://example.com/b",
    title: "Example B",
    tavilySnippet: "Snippet B",
    tavilyScore: 0.82,
    extractionStatus: "extracted",
    structureStatus: "failed",
    errorCode: "invalid_item",
  },
  {
    url: "https://www.linkedin.com/posts/failed",
    title: "LinkedIn post",
    tavilySnippet: "LinkedIn snippet",
    tavilyScore: 0.7,
    extractionStatus: "failed",
    structureStatus: "skipped",
    errorCode: "api_failure",
  },
];

function reviewJob(overrides = {}) {
  return {
    jobId: JOB_ID,
    status: "review",
    companyId: COMPANY_ID,
    companyName: "Browser Name Must Be Ignored",
    field: "interviewQuestions",
    result: {
      sources: JOB_SOURCES,
      items: [
        {
          question: "Implement an LRU Cache",
          kind: "coding",
          answer: "Use a map and a list.",
          intuition: "",
          evidence: "I was asked to implement an LRU cache.",
          sourceUrl: "https://example.com/a",
          sourceTitle: "Example",
        },
        {
          question: "What is CAP theorem?",
          kind: "non_coding",
          answer: "",
          intuition: "",
          evidence: "They asked CAP.",
          sourceUrl: "https://example.com/b",
          sourceTitle: "Example B",
        },
      ],
    },
    error: null,
    ...overrides,
  };
}

const app = express();
app.use(express.json());
app.use("/api/admin/platform", companyResearchRouter);

describe("publish research interview questions", () => {
  beforeEach(() => {
    store.clear();
    mockGetJSON.mockReset();
    mockSetJSON.mockReset();
    mockFindById.mockReset();
    mockFindOne.mockReset();
    mockUpdateOne.mockReset();
    mockInvalidate.mockReset();
    mockSetJSON.mockImplementation(async (key, value, ttl) => {
      store.set(key, { value, ttl });
      return true;
    });
    mockGetJSON.mockImplementation(async (key) => store.get(key)?.value ?? null);
    mockFindById.mockImplementation(() => leanOf({ _id: COMPANY_ID }));
    mockFindOne.mockImplementation(() => leanOf({ interviewQuestions: [] }));
    mockUpdateOne.mockResolvedValue({ acknowledged: true });
    mockInvalidate.mockResolvedValue(undefined);
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: reviewJob(),
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });
  });

  const reviewer = { name: "Ada", email: "ada@example.com" };

  it("rejects a missing job, a job that is not in review, and the wrong field", async () => {
    store.delete(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`);
    await expect(
      publishResearchInterviewQuestions({ jobId: JOB_ID, selectedIndexes: [0], reviewer })
    ).rejects.toMatchObject({ code: "job_not_found", status: 404 });

    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: reviewJob({ status: "queued" }),
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });
    await expect(
      publishResearchInterviewQuestions({ jobId: JOB_ID, selectedIndexes: [0], reviewer })
    ).rejects.toMatchObject({ code: "not_reviewable" });

    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: reviewJob({ field: "codingQuestions" }),
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });
    await expect(
      publishResearchInterviewQuestions({ jobId: JOB_ID, selectedIndexes: [0], reviewer })
    ).rejects.toMatchObject({ code: "not_reviewable" });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it("rejects an empty selection and an invalid index", async () => {
    await expect(
      publishResearchInterviewQuestions({ jobId: JOB_ID, selectedIndexes: [], reviewer })
    ).rejects.toBeInstanceOf(PublishResearchError);
    await expect(
      publishResearchInterviewQuestions({ jobId: JOB_ID, selectedIndexes: [0, 0], reviewer })
    ).rejects.toMatchObject({ code: "invalid_selection" });
    await expect(
      publishResearchInterviewQuestions({ jobId: JOB_ID, selectedIndexes: [9], reviewer })
    ).rejects.toMatchObject({ code: "invalid_selection" });
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it("requires a real company and inserts only the selected candidate", async () => {
    mockFindById.mockImplementationOnce(() => leanOf(null));
    await expect(
      publishResearchInterviewQuestions({ jobId: JOB_ID, selectedIndexes: [0], reviewer })
    ).rejects.toMatchObject({ code: "company_not_found" });
    expect(mockUpdateOne).not.toHaveBeenCalled();

    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: reviewJob(),
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });
    const result = await publishResearchInterviewQuestions({
      jobId: JOB_ID,
      selectedIndexes: [0],
      reviewer,
    });

    expect(result).toEqual({
      jobId: JOB_ID,
      status: "published",
      insertedCount: 1,
      duplicateCount: 0,
    });
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ companyId: COMPANY_ID });
    expect(options).toEqual({ upsert: true });
    expect(update.$set).toBeUndefined();
    expect(Object.keys(update.$push).sort()).toEqual(["interviewQuestions"]);
    expect(update.$setOnInsert.onlineQuestions).toEqual([]);
    expect(update.$setOnInsert.codingQuestions).toEqual([]);
    expect(update.$setOnInsert.mcqQuestions).toEqual([]);
    const inserted = update.$push.interviewQuestions.$each;
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      prepRoleKey: "",
      question: "Implement an LRU Cache",
      kind: "coding",
      answer: "Use a map and a list.",
      status: "approved",
      reviewedBy: { name: "Ada", email: "ada@example.com" },
    });
    expect(inserted[0].evidence).toBeUndefined();
    expect(inserted[0].sourceUrl).toBeUndefined();
    expect(inserted[0].submittedBy).toBeUndefined();
    expect(mockInvalidate).toHaveBeenCalledWith(COMPANY_ID);
    expect(store.get(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`).value.status).toBe("published");
  });

  it("does not write Mongo when every selected question is a duplicate", async () => {
    mockFindOne.mockImplementation(() =>
      leanOf({
        interviewQuestions: [{ question: "Implement an LRU Cache" }],
      })
    );
    const result = await publishResearchInterviewQuestions({
      jobId: JOB_ID,
      selectedIndexes: [0],
      reviewer,
    });
    expect(result).toMatchObject({
      insertedCount: 0,
      duplicateCount: 1,
    });
    expect(mockUpdateOne).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it("skips duplicates, still marks the job published, and does not publish twice", async () => {
    mockFindOne.mockImplementation(() =>
      leanOf({
        interviewQuestions: [{ question: "Implement an LRU cache!" }],
        onlineQuestions: [{ question: "Keep this OA question" }],
      })
    );

    const first = await publishResearchInterviewQuestions({
      jobId: JOB_ID,
      selectedIndexes: [0, 1],
      reviewer,
    });
    expect(first).toEqual({
      jobId: JOB_ID,
      status: "published",
      insertedCount: 1,
      duplicateCount: 1,
    });
    const inserted = mockUpdateOne.mock.calls[0][1].$push.interviewQuestions.$each;
    expect(inserted.map((item) => item.question)).toEqual(["What is CAP theorem?"]);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);

    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: reviewJob(),
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });
    mockFindOne.mockImplementation(() =>
      leanOf({
        interviewQuestions: [
          { question: "Implement an LRU cache!" },
          { question: "What is CAP theorem?" },
        ],
      })
    );
    mockUpdateOne.mockClear();
    mockInvalidate.mockClear();
    const duplicatesOnly = await publishResearchInterviewQuestions({
      jobId: JOB_ID,
      selectedIndexes: [0, 1],
      reviewer,
    });
    expect(duplicatesOnly).toEqual({
      jobId: JOB_ID,
      status: "published",
      insertedCount: 0,
      duplicateCount: 2,
    });
    expect(mockUpdateOne).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();

    await expect(
      publishResearchInterviewQuestions({ jobId: JOB_ID, selectedIndexes: [1], reviewer })
    ).rejects.toMatchObject({ code: "already_published", status: 409 });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it("publishes selected OA questions into onlineQuestions and skips research links", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: reviewJob({ field: "onlineQuestions", role: "SDE" }),
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });
    mockFindOne.mockImplementation(() => leanOf({ onlineQuestions: [], mcqQuestions: [], prepRoles: [] }));

    const result = await publishResearchInterviewQuestions({
      jobId: JOB_ID,
      selectedIndexes: [1],
      reviewer,
    });
    expect(result).toMatchObject({ insertedCount: 1, duplicateCount: 0 });
    const update = mockUpdateOne.mock.calls[0][1];
    expect(Object.keys(update.$push)).toEqual(["onlineQuestions", "prepRoles"]);
    expect(update.$push.onlineQuestions.$each[0]).toMatchObject({
      prepRoleKey: "sde",
      question: "What is CAP theorem?",
      kind: "non_coding",
      status: "approved",
    });
    expect(update.$setOnInsert.prepRoles).toBeUndefined();
    expect(update.$setOnInsert.onlineQuestions).toBeUndefined();
    expect(update.$setOnInsert.interviewQuestions).toEqual([]);
    expect(update.$push.onlineQuestions.$each[0].sourceUrl).toBeUndefined();
  });

  it("publishes OA MCQs into mcqQuestions and coding into onlineQuestions", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: reviewJob({
        field: "onlineQuestions",
        role: "Analyst",
        result: {
          sources: [],
          items: [
            {
              form: "mcq",
              question: "Which index speeds up lookups?",
              evidence: "MCQ on indexes.",
              mcqMetadata: {
                options: [
                  { id: "A", text: "Primary key" },
                  { id: "B", text: "Secondary index" },
                ],
                correctOptionId: "B",
              },
            },
            {
              form: "coding",
              question: "Reverse a linked list.",
              evidence: "Coding on linked list.",
            },
          ],
        },
      }),
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });
    mockFindOne.mockImplementation(() =>
      leanOf({ onlineQuestions: [], mcqQuestions: [], prepRoles: [] })
    );

    const result = await publishResearchInterviewQuestions({
      jobId: JOB_ID,
      selectedIndexes: [0, 1],
      reviewer,
    });
    expect(result).toMatchObject({ insertedCount: 2, duplicateCount: 0 });
    const update = mockUpdateOne.mock.calls[0][1];
    expect(update.$push.mcqQuestions.$each[0]).toMatchObject({
      prepRoleKey: "analyst",
      question: "Which index speeds up lookups?",
      answer: "B",
      optionB: "Secondary index",
    });
    expect(update.$push.onlineQuestions.$each[0]).toMatchObject({
      prepRoleKey: "analyst",
      kind: "coding",
      question: "Reverse a linked list.",
    });
  });

  it("publishes selected interview experiences and does not store a source link", async () => {
    store.set(`${RESEARCH_JOB_KEY_PREFIX}${JOB_ID}`, {
      value: reviewJob({
        field: "interviewExperiences",
        role: "SDE",
        result: {
          sources: JOB_SOURCES,
          items: [
            {
              content: "Round 1 was two coding problems. I cleared it.",
              evidence: "Round 1 was two coding problems.",
              summarized: false,
              sourceUrl: "https://example.com/a",
              sourceTitle: "Example",
            },
          ],
        },
      }),
      ttl: RESEARCH_JOB_TTL_SECONDS,
    });
    mockFindOne.mockImplementation(() =>
      leanOf({
        interviewExperiences: [{ prepRoleKey: "sde", content: "An older writeup." }],
        prepRoles: [{ key: "sde", label: "SDE" }],
      })
    );

    const result = await publishResearchInterviewQuestions({
      jobId: JOB_ID,
      selectedIndexes: [0],
      reviewer,
    });
    expect(result).toMatchObject({ insertedCount: 1, duplicateCount: 0 });
    const inserted = mockUpdateOne.mock.calls[0][1].$push.interviewExperiences.$each[0];
    expect(inserted).toMatchObject({
      prepRoleKey: "sde",
      content: "Round 1 was two coding problems. I cleared it.",
      status: "approved",
      reviewedBy: { name: "Ada", email: "ada@example.com" },
    });
    expect(inserted.sourceUrl).toBeUndefined();
    expect(inserted.evidence).toBeUndefined();
    expect(inserted.summarized).toBeUndefined();
    expect(mockUpdateOne.mock.calls[0][1].$push.prepRoles).toBeUndefined();
    const sources = mockUpdateOne.mock.calls[0][1].$push.researchSources.$each;
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0]).toMatchObject({
      prepRoleKey: "sde",
      url: "https://example.com/a",
    });
  });

  it("publishes through the admin route using only selected indexes and the authenticated reviewer", async () => {
    const response = await request(app)
      .post(`/api/admin/platform/company-research/${JOB_ID}/publish`)
      .send({
        selectedIndexes: [1],
        question: "Injected question",
        evidence: "Injected evidence",
        sourceUrl: "https://evil.example",
      })
      .expect(200);

    expect(response.body).toEqual({
      jobId: JOB_ID,
      status: "published",
      insertedCount: 1,
      duplicateCount: 0,
    });
    expect(response.body.result).toBeUndefined();
    const inserted = mockUpdateOne.mock.calls[0][1].$push.interviewQuestions.$each[0];
    expect(inserted.question).toBe("What is CAP theorem?");
    expect(inserted.reviewedBy).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(JSON.stringify(inserted)).not.toMatch(/Injected|evil\.example/);

    const again = await request(app)
      .post(`/api/admin/platform/company-research/${JOB_ID}/publish`)
      .send({ selectedIndexes: [1] })
      .expect(409);
    expect(again.body.error).toEqual({
      code: "already_published",
      message: "Research job is already published.",
    });
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);
  });
});
