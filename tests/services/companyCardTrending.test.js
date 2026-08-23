import { describe, it, expect } from "@jest/globals";
import { laterDateIso } from "../../utils/laterDate.js";
import {
  isRapidViewSpike,
  istHourBucket,
  ADMIN_CARD_VIEWS_TTL_SECONDS,
  TRENDING_VIEWS_CURRENT_HOUR_MIN,
} from "../../services/companyCardTrendingPure.js";
import { stripCompanyListViews } from "../../services/companyCardTrendingPure.js";

describe("laterDateIso", () => {
  it("picks the latest timestamp", () => {
    expect(
      laterDateIso("2026-01-01T00:00:00.000Z", "2026-03-15T12:00:00.000Z", null)
    ).toBe("2026-03-15T12:00:00.000Z");
  });

  it("returns null when empty", () => {
    expect(laterDateIso(null, undefined, "")).toBeNull();
  });
});

describe("isRapidViewSpike", () => {
  it("flags a busy current hour", () => {
    expect(isRapidViewSpike(TRENDING_VIEWS_CURRENT_HOUR_MIN, 0)).toBe(true);
  });

  it("flags a two-hour burst", () => {
    expect(isRapidViewSpike(6, 6)).toBe(true);
  });

  it("ignores quiet traffic", () => {
    expect(isRapidViewSpike(2, 1)).toBe(false);
  });
});

describe("istHourBucket", () => {
  it("formats a stable IST hour key", () => {
    const bucket = istHourBucket(new Date("2026-08-23T06:30:00.000Z"));
    expect(bucket).toMatch(/^\d{10}$/);
  });
});

describe("stripCompanyListViews", () => {
  it("removes views from every card payload", () => {
    const stripped = stripCompanyListViews([
      { name: "Acme", views: 12 },
      { name: "Beta" },
    ]);
    expect(stripped).toEqual([{ name: "Acme" }, { name: "Beta" }]);
  });

  it("keeps admin snapshots on a 3-hour Redis TTL", () => {
    expect(ADMIN_CARD_VIEWS_TTL_SECONDS).toBe(3 * 60 * 60);
  });
});
