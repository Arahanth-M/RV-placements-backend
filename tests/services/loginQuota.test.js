import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

describe("loginQuota", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, PLATFORM_OWNER_EMAILS: "owner@example.com" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function loadQuota(now = new Date("2026-11-22T08:00:00.000Z")) {
    const { createLoginQuota, createInMemoryLoginQuotaStore, LOGIN_QUOTA_LIMIT } =
      await import("../../services/loginQuota.js");
    return {
      LOGIN_QUOTA_LIMIT,
      quota: createLoginQuota({
        redisUrl: "",
        memory: createInMemoryLoginQuotaStore(),
        now: () => now,
      }),
    };
  }

  it("allows 3 logins then blocks the 4th within 24h for a normal email", async () => {
    const { quota, LOGIN_QUOTA_LIMIT } = await loadQuota();
    const email = "student@gmail.com";

    for (let i = 1; i <= LOGIN_QUOTA_LIMIT; i += 1) {
      const slot = await quota.consume(email);
      expect(slot.exceeded).toBe(false);
      expect(slot.used).toBe(i);
      expect(slot.remaining).toBe(LOGIN_QUOTA_LIMIT - i);
      expect(slot.skipped).toBe(false);
    }

    const blocked = await quota.consume(email);
    expect(blocked.exceeded).toBe(true);
    expect(blocked.reason).toBe("login_limit");
    expect(blocked.remaining).toBe(0);
  });

  it("never caps platform owner emails", async () => {
    const { quota } = await loadQuota();
    for (let i = 0; i < 10; i += 1) {
      const slot = await quota.consume("owner@example.com");
      expect(slot.exceeded).toBe(false);
      expect(slot.skipped).toBe(true);
      expect(slot.limit).toBeNull();
    }
  });

  it("tracks emails independently", async () => {
    const { quota } = await loadQuota();
    for (let i = 0; i < 3; i += 1) {
      expect((await quota.consume("a@gmail.com")).exceeded).toBe(false);
    }
    expect((await quota.consume("a@gmail.com")).exceeded).toBe(true);
    expect((await quota.consume("b@gmail.com")).exceeded).toBe(false);
  });

  it("resets after the rolling 24h window", async () => {
    let now = new Date("2026-11-22T08:00:00.000Z");
    const { createLoginQuota, createInMemoryLoginQuotaStore } = await import(
      "../../services/loginQuota.js"
    );
    const quota = createLoginQuota({
      redisUrl: "",
      memory: createInMemoryLoginQuotaStore(),
      now: () => now,
    });

    for (let i = 0; i < 3; i += 1) {
      expect((await quota.consume("reset@gmail.com")).exceeded).toBe(false);
    }
    expect((await quota.consume("reset@gmail.com")).exceeded).toBe(true);

    now = new Date("2026-11-23T08:00:01.000Z");
    expect((await quota.consume("reset@gmail.com")).exceeded).toBe(false);
  });
});
