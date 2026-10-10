import { readFileSync } from "node:fs";
import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const mockGetJSON = jest.fn();
const mockSetJSON = jest.fn();
const mockResearch = jest.fn();
const mockEnqueue = jest.fn();
const mockSuggestFresherRoles = jest.fn();
const mockListRvceVisitRoles = jest.fn();
const roleSets = new Map();

jest.unstable_mockModule("../../src/utils/redisHelpers.js", () => ({
  getJSON: (...args) => mockGetJSON(...args),
  setJSON: (...args) => mockSetJSON(...args),
  addToSet: async (key, value) => {
    if (!roleSets.has(key)) roleSets.set(key, new Set());
    roleSets.get(key).add(value);
    return true;
  },
  getSetMembers: async (key) => [...(roleSets.get(key) || [])],
}));

jest.unstable_mockModule("../../services/companyResearch/researchInterviewQuestions.js", () => ({
  researchInterviewQuestions: (...args) => mockResearch(...args),
  DEFAULT_MAX_SOURCES: 3,
  MAX_SOURCES_CAP: 8,
}));

jest.unstable_mockModule("../../services/companyResearch/suggestFresherRoles.js", () => ({
  suggestFresherRoles: (...args) => mockSuggestFresherRoles(...args),
}));

jest.unstable_mockModule("../../services/companyResearch/rvceVisitRoles.js", () => ({
  listRvceVisitRoles: (...args) => mockListRvceVisitRoles(...args),
}));

jest.unstable_mockModule("../../services/queues/companyResearchQueue.js", () => ({
  enqueueCompanyResearchJob: (...args) => mockEnqueue(...args),
  COMPANY_RESEARCH_QUEUE: "company-research-queue",
  RUN_COMPANY_RESEARCH: "run-company-research",
}));

jest.unstable_mockModule("../../middleware/authJWT.js", () => ({
  default: (req, _res, next) => {
    req.user = { isAdminSession: true, isSuperAdmin: true, adminScope: "platform" };
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

const { default: companyResearchRouter } = await import("../../routes/companyResearchRoutes.js");
const { RESEARCH_JOB_TTL_SECONDS, RESEARCH_JOB_KEY_PREFIX, RESEARCH_ACTIVE_KEY_PREFIX, activeRoleSetKey } =
  await import("../../services/companyResearch/researchJobService.js");

const app = express();
app.use(express.json());
app.use("/api/admin/platform", companyResearchRouter);

const store = new Map();

describe("company research API", () => {
  beforeEach(() => {
    store.clear();
    roleSets.clear();
    mockResearch.mockReset();
    mockSuggestFresherRoles.mockReset();
    mockListRvceVisitRoles.mockReset();
    mockListRvceVisitRoles.mockResolvedValue([]);
    mockEnqueue.mockReset();
    mockEnqueue.mockResolvedValue({ id: "bull-job" });
    mockGetJSON.mockReset();
    mockSetJSON.mockReset();
    mockSetJSON.mockImplementation(async (key, value, ttl) => {
      store.set(key, { value, ttl });
      return true;
    });
    mockGetJSON.mockImplementation(async (key) => store.get(key)?.value ?? null);
  });

  function postResearch(body) {
    return request(app).post("/api/admin/platform/company-research").send(body);
  }

  it("queues a Redis job and returns immediately without running research", async () => {
    const response = await postResearch({
      companyId: "amazon-id",
      companyName: "Amazon",
      field: "interviewQuestions",
      role: "Software Engineer",
      country: "India",
      maxSources: 3,
      searchDepth: "basic",
    }).expect(200);

    expect(response.body).toEqual({
      jobId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      ),
      status: "queued",
    });
    const key = `${RESEARCH_JOB_KEY_PREFIX}${response.body.jobId}`;
    expect(store.get(key).ttl).toBe(RESEARCH_JOB_TTL_SECONDS);
    expect(RESEARCH_JOB_TTL_SECONDS).toBe(24 * 60 * 60);
    expect(store.get(key).value.status).toBe("queued");
    const jobWrites = mockSetJSON.mock.calls.filter((call) =>
      String(call[0]).startsWith(RESEARCH_JOB_KEY_PREFIX)
    );
    expect(jobWrites.map((call) => call[1].status)).toEqual(["queued"]);
    expect(store.get(`${RESEARCH_ACTIVE_KEY_PREFIX}amazon-id:interviewQuestions:software-engineer`).value).toEqual({
      jobId: response.body.jobId,
    });
    expect(roleSets.get(activeRoleSetKey("amazon-id"))).toEqual(new Set([response.body.jobId]));
    expect(mockResearch).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith({
      jobId: response.body.jobId,
      companyId: "amazon-id",
      companyName: "Amazon",
      field: "interviewQuestions",
      role: "Software Engineer",
      country: "India",
      maxSources: 3,
      searchDepth: "basic",
    });
    expect(JSON.stringify(mockEnqueue.mock.calls[0][0])).not.toMatch(/GROQ|TAVILY|FIRECRAWL|apiKey/i);
  });

  it("returns the queued job and 404 for an unknown id", async () => {
    const created = await postResearch({
      companyId: "amazon-id",
      companyName: "Amazon",
      field: "interviewQuestions",
      role: "Software Engineer",
      country: "India",
    }).expect(200);

    const status = await request(app)
      .get(`/api/admin/platform/company-research/${created.body.jobId}`)
      .expect(200);
    expect(status.body.jobId).toBe(created.body.jobId);
    expect(status.body.status).toBe("queued");
    expect(status.body.companyName).toBe("Amazon");
    expect(status.body.result).toBeNull();

    await request(app)
      .get("/api/admin/platform/company-research/not-a-job")
      .expect(404);
    await request(app)
      .get("/api/admin/platform/company-research/11111111-1111-1111-1111-111111111111")
      .expect(404);
  });

  it("returns each company's latest job so research can continue after leaving the page", async () => {
    const amazon = await postResearch({
      companyId: "amazon-id",
      companyName: "Amazon",
      field: "interviewQuestions",
      role: "SDE",
      country: "India",
    }).expect(200);
    const google = await postResearch({
      companyId: "google-id",
      companyName: "Google",
      field: "interviewExperiences",
      role: "SDE",
      country: "India",
    }).expect(200);

    const amazonJobs = await request(app)
      .get("/api/admin/platform/companies/amazon-id/company-research")
      .expect(200);
    const googleJobs = await request(app)
      .get("/api/admin/platform/companies/google-id/company-research")
      .expect(200);

    expect(amazonJobs.body.jobs.map((job) => job.jobId)).toEqual([amazon.body.jobId]);
    expect(amazonJobs.body.jobs[0]).toEqual(
      expect.objectContaining({ status: "queued", field: "interviewQuestions", companyName: "Amazon" })
    );
    expect(googleJobs.body.jobs.map((job) => job.jobId)).toEqual([google.body.jobId]);
    expect(googleJobs.body.jobs[0].field).toBe("interviewExperiences");

    const analyst = await postResearch({
      companyId: "amazon-id",
      companyName: "Amazon",
      field: "interviewQuestions",
      role: "Data Analyst",
      country: "India",
    }).expect(200);
    const amazonRoles = await request(app)
      .get("/api/admin/platform/companies/amazon-id/company-research")
      .expect(200);
    expect(amazonRoles.body.jobs.map((job) => job.jobId).sort()).toEqual(
      [amazon.body.jobId, analyst.body.jobId].sort()
    );

    await request(app).get("/api/admin/platform/companies/not%20valid/company-research").expect(400);
  });

  it("returns fresher roles suggested from public hiring pages", async () => {
    mockSuggestFresherRoles.mockResolvedValue(["SDE", "Data Analyst"]);

    const response = await request(app)
      .get("/api/admin/platform/companies/amazon-id/fresher-roles")
      .query({ companyName: "Amazon" })
      .expect(200);

    expect(mockSuggestFresherRoles).toHaveBeenCalledWith({
      companyId: "amazon-id",
      companyName: "Amazon",
    });
    expect(mockListRvceVisitRoles).toHaveBeenCalledWith("amazon-id");
    expect(response.body.roles).toEqual(["SDE", "Data Analyst"]);
  });

  it("includes RVCE visit roles and hides TBD", async () => {
    mockSuggestFresherRoles.mockResolvedValue(["Data Analyst", "SDE"]);
    mockListRvceVisitRoles.mockResolvedValue(["Software Engineer", "TBD", "Data Analyst"]);

    const response = await request(app)
      .get("/api/admin/platform/companies/amazon-id/fresher-roles")
      .query({ companyName: "Amazon" })
      .expect(200);

    expect(response.body.roles).toEqual(["Software Engineer", "Data Analyst", "SDE"]);

    await request(app)
      .get("/api/admin/platform/companies/amazon-id/fresher-roles")
      .expect(400);
  });

  it("saves edited question, answer, and experience text on a review job", async () => {
    const jobId = "11111111-1111-4111-8111-111111111111";
    const experienceId = "22222222-2222-4222-8222-222222222222";
    await mockSetJSON(`${RESEARCH_JOB_KEY_PREFIX}${jobId}`, {
      jobId,
      status: "review",
      companyId: "amazon-id",
      companyName: "Amazon",
      field: "interviewQuestions",
      result: {
        items: [
          {
            question: "Implement an LRU cache.",
            kind: "coding",
            answer: "Use a map.",
            intuition: "O(1).",
            solutions: { cpp: "old", java: "", python: "" },
          },
        ],
      },
    });
    await mockSetJSON(`${RESEARCH_JOB_KEY_PREFIX}${experienceId}`, {
      jobId: experienceId,
      status: "review",
      companyId: "amazon-id",
      companyName: "Amazon",
      field: "interviewExperiences",
      result: { items: [{ content: "Original writeup." }] },
    });

    const edited = await request(app)
      .put(`/api/admin/platform/company-research/${jobId}/items/0`)
      .send({
        question: "Implement an LRU cache with O(1) operations.",
        answer: "Hash map plus doubly linked list.",
        intuition: "Move the node on each get.",
        solutions: { cpp: "class LRU {};", java: "class LRU {}", python: "class LRU: pass" },
      })
      .expect(200);
    expect(edited.body.item.question).toBe("Implement an LRU cache with O(1) operations.");
    expect(edited.body.item.answer).toBe("Hash map plus doubly linked list.");
    expect(store.get(`${RESEARCH_JOB_KEY_PREFIX}${jobId}`).value.result.items[0].solutions.cpp).toBe(
      "class LRU {};"
    );

    const experience = await request(app)
      .put(`/api/admin/platform/company-research/${experienceId}/items/0`)
      .send({ content: "Updated interview writeup." })
      .expect(200);
    expect(experience.body.item.content).toBe("Updated interview writeup.");

    const nonCoding = await request(app)
      .put(`/api/admin/platform/company-research/${jobId}/items/0`)
      .send({ kind: "non_coding" })
      .expect(200);
    expect(nonCoding.body.item.kind).toBe("non_coding");
    expect(nonCoding.body.item.form).toBe("non_coding");
    expect(nonCoding.body.item.solutions).toEqual({ cpp: "", java: "", python: "" });

    const coding = await request(app)
      .put(`/api/admin/platform/company-research/${jobId}/items/0`)
      .send({ kind: "coding" })
      .expect(200);
    expect(coding.body.item.kind).toBe("coding");
    expect(coding.body.item.form).toBe("coding");

    await request(app)
      .put(`/api/admin/platform/company-research/${jobId}/items/0`)
      .send({ kind: "sql" })
      .expect(400);

    await request(app)
      .put(`/api/admin/platform/company-research/${jobId}/items/0`)
      .send({ question: "   " })
      .expect(400);

    store.get(`${RESEARCH_JOB_KEY_PREFIX}${jobId}`).value.status = "published";
    await request(app)
      .put(`/api/admin/platform/company-research/${jobId}/items/0`)
      .send({ question: "Should not save." })
      .expect(409);
  });

  it("deletes one review question and keeps the questions after it", async () => {
    const jobId = "33333333-3333-4333-8333-333333333333";
    await mockSetJSON(`${RESEARCH_JOB_KEY_PREFIX}${jobId}`, {
      jobId,
      status: "review",
      companyId: "amazon-id",
      companyName: "Amazon",
      field: "interviewQuestions",
      result: {
        items: [
          { question: "Leaders in an array", answer: "Scan from the right." },
          { question: "Pairs with sum divisible by K", answer: "Count remainders." },
        ],
      },
    });

    const deleted = await request(app)
      .delete(`/api/admin/platform/company-research/${jobId}/items/0`)
      .expect(200);
    expect(deleted.body.index).toBe(0);
    expect(deleted.body.items.map((item) => item.question)).toEqual([
      "Pairs with sum divisible by K",
    ]);
    expect(store.get(`${RESEARCH_JOB_KEY_PREFIX}${jobId}`).value.result.items).toHaveLength(1);

    await request(app).delete(`/api/admin/platform/company-research/${jobId}/items/4`).expect(400);

    store.get(`${RESEARCH_JOB_KEY_PREFIX}${jobId}`).value.status = "published";
    await request(app).delete(`/api/admin/platform/company-research/${jobId}/items/0`).expect(409);
  });

  it("queues interview experiences without running research and rejects OA research", async () => {
    const response = await postResearch({
      companyId: "amazon-id",
      companyName: "Amazon",
      field: "interviewExperiences",
      role: "SDE",
      country: "India",
      maxSources: 2,
    }).expect(200);
    expect(response.body.status).toBe("queued");
    expect(mockEnqueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ field: "interviewExperiences", maxSources: 2, role: "SDE" })
    );
    expect(store.get(`${RESEARCH_JOB_KEY_PREFIX}${response.body.jobId}`).value.field).toBe(
      "interviewExperiences"
    );

    const rejected = await postResearch({
      companyId: "amazon-id",
      companyName: "Amazon",
      field: "onlineQuestions",
      role: "SDE",
      country: "India",
    }).expect(400);
    expect(rejected.body.error).toMatch(/interviewQuestions or interviewExperiences/);
    expect(mockResearch).not.toHaveBeenCalled();
  });

  it("rejects an unsupported field and invalid parameters before research", async () => {
    const cases = [
      { companyId: "id", companyName: "Amazon", field: "codingQuestions" },
      { companyId: "  ", companyName: "Amazon", field: "interviewQuestions" },
      { companyId: "id", companyName: "", field: "interviewQuestions" },
      { companyId: "id", companyName: "Amazon", field: "interviewQuestions", maxSources: 9 },
      { companyId: "id", companyName: "Amazon", field: "interviewQuestions", searchDepth: "deep" },
      { companyId: "id", companyName: "Amazon", field: "interviewQuestions", role: 12 },
      { companyId: "id", companyName: "Amazon", field: "onlineQuestions", role: "SDE" },
    ];

    for (const body of cases) {
      const response = await postResearch(body).expect(400);
      expect(response.body.error).toEqual(expect.any(String));
    }
    expect(mockResearch).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockSetJSON).not.toHaveBeenCalled();
  });

  it("does not reference company Mongo models", () => {
    const files = [
      "routes/companyResearchRoutes.js",
      "services/companyResearch/researchJobService.js",
      "workers/companyResearchWorker.js",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/CompanyStatic|CompanyPlatformContent|CompanyVisit|mongoose/);
    }
  });
});
