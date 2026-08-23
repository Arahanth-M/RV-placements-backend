import { describe, it, expect } from "@jest/globals";
import {
  activeMsFlushUpdate,
  clampHeartbeatDeltaMs,
  combineActiveMs,
  creditHeartbeatMs,
  formatActiveMsLabel,
  MAX_HEARTBEAT_DELTA_MS,
  MIN_HEARTBEAT_INTERVAL_MS,
} from "../../services/dau/dauActiveTimePure.js";

describe("clampHeartbeatDeltaMs", () => {
  it("drops non-positive values", () => {
    expect(clampHeartbeatDeltaMs(0)).toBe(0);
    expect(clampHeartbeatDeltaMs(-12)).toBe(0);
    expect(clampHeartbeatDeltaMs("nope")).toBe(0);
  });

  it("caps oversized claims", () => {
    expect(clampHeartbeatDeltaMs(MAX_HEARTBEAT_DELTA_MS + 50_000)).toBe(
      MAX_HEARTBEAT_DELTA_MS
    );
  });
});

describe("creditHeartbeatMs", () => {
  const now = 1_000_000;

  it("credits the first ping up to the max delta", () => {
    expect(
      creditHeartbeatMs({ deltaMs: 45_000, lastAcceptedAt: null, now })
    ).toBe(45_000);
  });

  it("rejects pings faster than the minimum interval", () => {
    expect(
      creditHeartbeatMs({
        deltaMs: 45_000,
        lastAcceptedAt: now - (MIN_HEARTBEAT_INTERVAL_MS - 1),
        now,
      })
    ).toBe(0);
  });

  it("does not credit more than wall-clock time since last ping", () => {
    expect(
      creditHeartbeatMs({
        deltaMs: 60_000,
        lastAcceptedAt: now - 25_000,
        now,
      })
    ).toBe(25_000);
  });
});

describe("formatActiveMsLabel", () => {
  it("shows an em dash when nothing is stored yet", () => {
    expect(formatActiveMsLabel(undefined)).toBe("—");
    expect(formatActiveMsLabel(0)).toBe("—");
    expect(formatActiveMsLabel(null)).toBe("—");
  });

  it("formats minutes and hours", () => {
    expect(formatActiveMsLabel(12_000)).toBe("<1m");
    expect(formatActiveMsLabel(12 * 60_000)).toBe("12m");
    expect(formatActiveMsLabel(75 * 60_000)).toBe("1h 15m");
    expect(formatActiveMsLabel(2 * 60 * 60_000)).toBe("2h");
  });
});

describe("combineActiveMs", () => {
  it("adds Redis pending onto Mongo without inventing a value", () => {
    expect(combineActiveMs(undefined, undefined)).toBeNull();
    expect(combineActiveMs(10_000, 5_000)).toBe(15_000);
    expect(combineActiveMs(undefined, 4_000)).toBe(4_000);
  });
});

describe("activeMsFlushUpdate", () => {
  it("only sets identity on insert and increments activeMs", () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const update = activeMsFlushUpdate({
      userId: "u1",
      email: "A@College.EDU",
      username: "Ada",
      role: "student",
      dayKey: "2026-08-23",
      now,
      ms: 180000,
    });
    expect(update.$inc).toEqual({ activeMs: 180000 });
    expect(update.$set).toEqual({ lastSeenAt: now });
    expect(update.$set.email).toBeUndefined();
    expect(update.$set.username).toBeUndefined();
    expect(update.$setOnInsert.email).toBe("a@college.edu");
    expect(update.$setOnInsert.userId).toBe("u1");
  });
});
