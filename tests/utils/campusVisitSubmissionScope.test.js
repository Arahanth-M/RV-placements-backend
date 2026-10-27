import { describe, it, expect } from "@jest/globals";
import {
  isPlatformContentSubmission,
  mongoMatchCampusVisitSubmissions,
  mongoMatchInstitutionalEmailForCollege,
  withCampusVisitSubmissionScope,
} from "../../utils/collegeScope.js";

describe("campus visit submission scope", () => {
  it("detects /general platform submissions", () => {
    expect(isPlatformContentSubmission({ contentScope: "platform" })).toBe(true);
    expect(isPlatformContentSubmission({ contentScope: "Platform" })).toBe(true);
    expect(isPlatformContentSubmission({ contentScope: "visit" })).toBe(false);
    expect(isPlatformContentSubmission({})).toBe(false);
    expect(isPlatformContentSubmission(null)).toBe(false);
  });

  it("excludes contentScope platform via $ne", () => {
    expect(mongoMatchCampusVisitSubmissions()).toEqual({
      contentScope: { $ne: "platform" },
    });
  });

  it("combines college email scope with campus-only contentScope", () => {
    const query = withCampusVisitSubmissionScope({ status: "pending" }, "rvce");
    expect(query).toEqual({
      $and: [
        {
          $and: [{ status: "pending" }, { contentScope: { $ne: "platform" } }],
        },
        expect.any(Object),
      ],
    });
    const collegeClause = query.$and[1];
    expect(collegeClause).toHaveProperty("$nor");
  });

  it("scopes empty base to campus content + college email", () => {
    const query = withCampusVisitSubmissionScope({}, "rvce");
    expect(query).toEqual({
      $and: [{ contentScope: { $ne: "platform" } }, expect.any(Object)],
    });
  });
});

describe("institutional college email match (leaderboard)", () => {
  it("matches only @rvce.edu.in for RVCE campus", () => {
    expect(mongoMatchInstitutionalEmailForCollege("rvce", "email")).toEqual({
      email: { $regex: "@rvce\\.edu\\.in$", $options: "i" },
    });
  });

  it("matches RVITM institutional pattern for RVITM campus", () => {
    const match = mongoMatchInstitutionalEmailForCollege("rvitm", "email");
    expect(JSON.stringify(match)).toMatch(/rvitm@rvei/);
  });
});
