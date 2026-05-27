import { describe, it, expect, jest } from "@jest/globals";
import {
  createInMemoryCounters,
  createResumeAnalyzeLimiter,
} from "../../middleware/resumeAnalyzeLimiter.js";

describe("resumeAnalyzeLimiter", () => {
  function makeReq({ email = "test@rvce.edu.in" } = {}) {
    return {
      user: { email, userId: "user-1", _id: "507f1f77bcf86cd799439011" },
      ip: "127.0.0.1",
    };
  }

  function makeRes() {
    return {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  }

  it("returns 429 after limit exceeded (in-memory)", async () => {
    let nowMs = 0;
    const limiter = createResumeAnalyzeLimiter({
      minuteLimit: 2,
      dayLimit: 100,
      redisUrl: "",
      now: () => nowMs,
      inMemory: createInMemoryCounters(),
    });

    for (let i = 0; i < 2; i++) {
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();
      await limiter(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    }

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await limiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: "Too many analysis requests. Please try again later.",
    });
    expect(res.setHeader).toHaveBeenCalled();
  });

  it("falls back to in-memory when Redis is unavailable", async () => {
    let nowMs = 0;
    const redisClient = {
      incr: () => {
        throw new Error("redis down");
      },
      expire: () => Promise.resolve(),
    };

    const limiter = createResumeAnalyzeLimiter({
      minuteLimit: 2,
      dayLimit: 100,
      redisUrl: "redis://test",
      redisClient,
      now: () => nowMs,
      inMemory: createInMemoryCounters(),
    });

    // 3rd request should exceed minute limit even though Redis throws.
    for (let i = 0; i < 2; i++) {
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();
      await limiter(req, res, next);
      expect(next).toHaveBeenCalled();
    }

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await limiter(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: "Too many analysis requests. Please try again later.",
    });
  });

  it("resets counts after the minute bucket changes", async () => {
    let nowMs = 0;
    const limiter = createResumeAnalyzeLimiter({
      minuteLimit: 2,
      dayLimit: 100,
      redisUrl: "",
      now: () => nowMs,
      inMemory: createInMemoryCounters(),
    });

    const req = makeReq();
    // First two requests within same minute are allowed.
    for (let i = 0; i < 2; i++) {
      const res = makeRes();
      const next = jest.fn();
      await limiter(req, res, next);
      expect(next).toHaveBeenCalled();
    }

    // Third request is blocked.
    {
      const res = makeRes();
      const next = jest.fn();
      await limiter(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);
    }

    // Advance into the next minute bucket.
    nowMs = 60_000 + 1;

    // Next request should be allowed again.
    {
      const res = makeRes();
      const next = jest.fn();
      await limiter(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    }
  });
});

