import { describe, it, expect } from "@jest/globals";
import {
  createAtsUploadQuota,
  createInMemoryAtsUploadStore,
  ATS_UPLOAD_DAILY_LIMIT,
} from "../../middleware/resumeAtsUploadQuota.js";

describe("ats upload daily quota", () => {
  function makeReq() {
    return { user: { email: "student@rvce.edu.in", userId: "u1" }, ip: "127.0.0.1" };
  }

  it("allows 3 uploads then blocks the 4th in the same IST day", async () => {
    const quota = createAtsUploadQuota({
      redisUrl: "",
      memory: createInMemoryAtsUploadStore(),
      now: () => new Date("2026-08-29T06:00:00.000Z"),
    });

    for (let i = 1; i <= ATS_UPLOAD_DAILY_LIMIT; i++) {
      const slot = await quota.consume(makeReq());
      expect(slot.exceeded).toBe(false);
      expect(slot.used).toBe(i);
      expect(slot.remaining).toBe(ATS_UPLOAD_DAILY_LIMIT - i);
    }

    const blocked = await quota.consume(makeReq());
    expect(blocked.exceeded).toBe(true);
    expect(blocked.remaining).toBe(0);

    const peeked = await quota.getQuota(makeReq());
    expect(peeked.used).toBe(ATS_UPLOAD_DAILY_LIMIT);
    expect(peeked.remaining).toBe(0);
  });

  it("refunds a reserved slot so a failed score does not burn quota", async () => {
    const quota = createAtsUploadQuota({
      redisUrl: "",
      memory: createInMemoryAtsUploadStore(),
      now: () => new Date("2026-08-29T06:00:00.000Z"),
    });
    const slot = await quota.consume(makeReq());
    expect(slot.used).toBe(1);
    await slot.refund();
    const peeked = await quota.getQuota(makeReq());
    expect(peeked.used).toBe(0);
    expect(peeked.remaining).toBe(ATS_UPLOAD_DAILY_LIMIT);
  });
});
