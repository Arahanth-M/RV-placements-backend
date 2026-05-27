import { jest } from "@jest/globals";

const mockGetJSON = jest.fn();
const mockSetJSON = jest.fn();

jest.unstable_mockModule("../../src/utils/redisClient.js", () => ({
  redisUrl: "redis://test",
}));

jest.unstable_mockModule("../../src/utils/redisHelpers.js", () => ({
  getJSON: mockGetJSON,
  setJSON: mockSetJSON,
}));

const {
  createAtsAnalysisCacheKey,
  getCachedAtsAnalysis,
  setCachedAtsAnalysis,
} = await import("../../services/resume/analyze/cache.js");

describe("resume analyze cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("generates deterministic keys for identical inputs", () => {
    const payloadA = {
      templateId: "standard_ats",
      personal: { fullName: "Test User", email: "test@example.com" },
      skills: ["React", "Node.js"],
      education: [],
      projects: [],
      experience: [],
      certifications: [],
      achievements: [],
    };

    const payloadB = {
      personal: { email: "test@example.com", fullName: "Test User" },
      templateId: "standard_ats",
      skills: ["React", "Node.js"],
      education: [],
      projects: [],
      experience: [],
      certifications: [],
      achievements: [],
    };

    const key1 = createAtsAnalysisCacheKey({
      sanitizedResumePayload: payloadA,
    });
    const key2 = createAtsAnalysisCacheKey({
      sanitizedResumePayload: payloadB,
    });

    expect(key1).toBe(key2);
  });

  it("includes scorerVersion in the key", () => {
    const payload = {
      templateId: "standard_ats",
      personal: { fullName: "Test User", email: "test@example.com" },
      skills: ["React", "Node.js"],
      education: [],
      projects: [],
      experience: [],
      certifications: [],
      achievements: [],
    };

    const keyA = createAtsAnalysisCacheKey({
      sanitizedResumePayload: payload,
      scorerVersion: "v1",
    });
    const keyB = createAtsAnalysisCacheKey({
      sanitizedResumePayload: payload,
      scorerVersion: "v2",
    });

    expect(keyA).not.toBe(keyB);
  });

  it("returns cached analysis on cache hit", async () => {
    const payload = { templateId: "standard_ats", personal: { fullName: "A", email: "a@b.com" }, skills: ["React"] };
    const cacheKey = createAtsAnalysisCacheKey({ sanitizedResumePayload: payload });
    const cached = {
      overallScore: 88,
      breakdown: { completeness: 80, structure: 90, bulletQuality: 70, skills: 88, professionalism: 85 },
      tips: [],
      scorerVersion: "1.3.0",
    };

    mockGetJSON.mockResolvedValueOnce(cached);

    const result = await getCachedAtsAnalysis(cacheKey);
    expect(result).toEqual(cached);
    expect(mockGetJSON).toHaveBeenCalledWith(cacheKey);
  });

  it("returns null on cache miss", async () => {
    const payload = { templateId: "standard_ats", personal: { fullName: "A", email: "a@b.com" }, skills: ["React"] };
    const cacheKey = createAtsAnalysisCacheKey({ sanitizedResumePayload: payload });

    mockGetJSON.mockResolvedValueOnce(null);

    const result = await getCachedAtsAnalysis(cacheKey);
    expect(result).toBeNull();
  });

  it("falls back gracefully when Redis operations fail", async () => {
    const payload = { templateId: "standard_ats", personal: { fullName: "A", email: "a@b.com" }, skills: ["React"] };
    const cacheKey = createAtsAnalysisCacheKey({ sanitizedResumePayload: payload });

    mockGetJSON.mockRejectedValueOnce(new Error("redis down"));
    const cached = await getCachedAtsAnalysis(cacheKey);
    expect(cached).toBeNull();

    mockSetJSON.mockRejectedValueOnce(new Error("redis down"));
    const ok = await setCachedAtsAnalysis(cacheKey, { overallScore: 10 });
    expect(ok).toBe(false);
  });
});
