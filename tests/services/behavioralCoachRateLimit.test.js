import {
  checkBehavioralCoachHourlyLimit,
  resetBehavioralCoachHourlyMemory,
} from "../../services/billing/behavioralCoachRateLimit.js";
import { BEHAVIORAL_COACH_HOURLY_LIMIT } from "../../config/billingPlans.js";

describe("behavioralCoachRateLimit", () => {
  const prevForceMemory = process.env.BEHAVIORAL_COACH_RATE_LIMIT_MEMORY;

  beforeAll(() => {
    process.env.BEHAVIORAL_COACH_RATE_LIMIT_MEMORY = "1";
  });

  afterAll(() => {
    if (prevForceMemory == null) delete process.env.BEHAVIORAL_COACH_RATE_LIMIT_MEMORY;
    else process.env.BEHAVIORAL_COACH_RATE_LIMIT_MEMORY = prevForceMemory;
  });

  beforeEach(() => {
    resetBehavioralCoachHourlyMemory();
  });

  it("allows up to the hourly limit then blocks", async () => {
    const userId = "rate-limit-user";
    const now = new Date("2026-10-28T10:15:00.000Z");
    for (let i = 0; i < BEHAVIORAL_COACH_HOURLY_LIMIT; i += 1) {
      const ok = await checkBehavioralCoachHourlyLimit(userId, now);
      expect(ok.allowed).toBe(true);
    }
    const blocked = await checkBehavioralCoachHourlyLimit(userId, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});
