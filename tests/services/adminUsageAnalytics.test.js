import { describe, it, expect } from "@jest/globals";
import { usageAnalyticsIdentityIdsFromUsers } from "../../services/adminUsageAnalyticsService.js";

describe("usageAnalyticsIdentityIdsFromUsers", () => {
  it("prefers googleId used on PrepPath and interview sessions, and keeps Mongo _id as fallback", () => {
    expect(
      usageAnalyticsIdentityIdsFromUsers([
        { _id: "507f1f77bcf86cd799439011", googleId: "google-abc" },
        { _id: "507f1f77bcf86cd799439012" },
      ])
    ).toEqual(["google-abc", "507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"]);
  });

  it("skips blanks and duplicates", () => {
    expect(
      usageAnalyticsIdentityIdsFromUsers([
        { _id: "id-1", googleId: "id-1" },
        { googleId: "  " },
        null,
      ])
    ).toEqual(["id-1"]);
  });
});
