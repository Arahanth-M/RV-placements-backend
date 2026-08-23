import { describe, it, expect } from "@jest/globals";
import {
  visitContentTimestampIso,
  companyCardContentUpdatedAtIso,
} from "../../services/companyCardContentUpdatedPure.js";

describe("visitContentTimestampIso", () => {
  it("ignores visit.updatedAt so profile views do not count", () => {
    expect(
      visitContentTimestampIso({
        updatedAt: "2026-08-23T12:00:00.000Z",
        migratedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2025-06-01T00:00:00.000Z",
      })
    ).toBe("2026-01-01T00:00:00.000Z");
  });

  it("includes recruitment process submittedAt", () => {
    expect(
      visitContentTimestampIso({
        createdAt: "2026-01-01T00:00:00.000Z",
        recruitment_process: { submittedAt: "2026-04-15T08:00:00.000Z" },
      })
    ).toBe("2026-04-15T08:00:00.000Z");
  });
});

describe("companyCardContentUpdatedAtIso", () => {
  it("uses company static updatedAt for about, coding, and helpful votes", () => {
    expect(
      companyCardContentUpdatedAtIso({
        staticUpdatedAt: "2026-07-01T00:00:00.000Z",
        visits: [{ createdAt: "2026-01-01T00:00:00.000Z" }],
      })
    ).toBe("2026-07-01T00:00:00.000Z");
  });

  it("takes the latest content timestamp across cluster visits", () => {
    expect(
      companyCardContentUpdatedAtIso({
        staticUpdatedAt: "2026-01-01T00:00:00.000Z",
        visits: [
          { migratedAt: "2026-02-01T00:00:00.000Z" },
          { approvedAt: "2026-03-01T00:00:00.000Z" },
        ],
        extras: ["2026-03-15T00:00:00.000Z"],
      })
    ).toBe("2026-03-15T00:00:00.000Z");
  });
});
