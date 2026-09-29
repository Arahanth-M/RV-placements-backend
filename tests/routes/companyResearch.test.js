import { readFileSync } from "node:fs";
import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const mockGetJSON = jest.fn();
const mockSetJSON = jest.fn();
const mockResearch = jest.fn();
const mockEnqueue = jest.fn();

jest.unstable_mockModule("../../src/utils/redisHelpers.js", () => ({
  getJSON: (...args) => mockGetJSON(...args),
  setJSON: (...args) => mockSetJSON(...args),
}));

jest.unstable_mockModule("../../services/companyResearch/researchInterviewQuestions.js", () => ({
  researchInterviewQuestions: (...args) => mockResearch(...args),
  DEFAULT_MAX_SOURCES: 3,
  MAX_SOURCES_CAP: 8,
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
const { RESEARCH_JOB_TTL_SECONDS, RESEARCH_JOB_KEY_PREFIX } = await import(
  "../../services/companyResearch/researchJobService.js"
);

const app = express();
app.use(express.json());
app.use("/api/admin/platform", companyResearchRouter);

const store = new Map();

describe("company research API", () => {
  beforeEach(() => {
    store.clear();
    mockResearch.mockReset();
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
    expect(mockSetJSON.mock.calls.map((call) => call[1].status)).toEqual(["queued"]);
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

  it("queues OA questions and interview experiences without running research", async () => {
    for (const field of ["onlineQuestions", "interviewExperiences"]) {
      const response = await postResearch({
        companyId: "amazon-id",
        companyName: "Amazon",
        field,
        role: "SDE",
        country: "India",
        maxSources: 2,
      }).expect(200);
      expect(response.body.status).toBe("queued");
      expect(mockEnqueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ field, maxSources: 2, role: "SDE" })
      );
      expect(store.get(`${RESEARCH_JOB_KEY_PREFIX}${response.body.jobId}`).value.field).toBe(field);
    }
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
      { companyId: "id", companyName: "Amazon", field: "onlineQuestions", role: "" },
      { companyId: "id", companyName: "Amazon", field: "onlineQuestions", role: "Product Manager" },
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
