import { describe, expect, it } from "@jest/globals";
import {
  PLATFORM_FRESHER_ROLES,
  PLATFORM_INTERVIEW_ROUND_TYPES,
} from "../../config/interviewCatalog.js";
import {
  matchPlatformFresherRole,
  suggestGeneralMockInterview,
} from "../../services/prepPath/suggestGeneralMock.js";

describe("matchPlatformFresherRole", () => {
  it("returns exact catalog roles unchanged", () => {
    for (const role of PLATFORM_FRESHER_ROLES) {
      expect(matchPlatformFresherRole(role)).toBe(role);
    }
  });

  it("maps free-text PrepPath roles onto the fresher catalog", () => {
    expect(matchPlatformFresherRole("SDE Intern")).toBe("Software Engineer (SDE)");
    expect(matchPlatformFresherRole("frontend")).toBe("Frontend Engineer");
    expect(matchPlatformFresherRole("ML engineer")).toBe("AI/ML Engineer");
    expect(matchPlatformFresherRole("VLSI intern")).toBe("VLSI/Hardware Engineer");
    expect(matchPlatformFresherRole("data analyst")).toBe("Data Analyst");
    expect(matchPlatformFresherRole("consultant")).toBe("Consultant");
  });
});

describe("suggestGeneralMockInterview", () => {
  it("suggests intern SDE rounds at easy when the plan is short", () => {
    const suggestion = suggestGeneralMockInterview({
      role: "SDE Intern",
      track: "summer_internship",
      days: 2,
      flags: { usedOA: true, usedMustDo: true },
    });
    expect(suggestion.role).toBe("Software Engineer (SDE)");
    expect(suggestion.difficulty).toBe("easy");
    expect(suggestion.rounds).toEqual(["DSA", "Aptitude", "HR"]);
    expect(suggestion.rounds.every((r) => PLATFORM_INTERVIEW_ROUND_TYPES.includes(r))).toBe(
      true
    );
    expect(suggestion.why).toMatch(/OA/);
    expect(suggestion.why).toMatch(/intern track/);
  });

  it("suggests Web Dev instead of CS Fundamentals for Frontend Engineer FTE", () => {
    const suggestion = suggestGeneralMockInterview({
      role: "Frontend Engineer",
      track: "full_time",
      days: 5,
    });
    expect(suggestion.role).toBe("Frontend Engineer");
    expect(suggestion.rounds).toEqual(["DSA", "Web Dev", "HR"]);
  });

  it("suggests FTE SDE rounds at medium by default", () => {
    const suggestion = suggestGeneralMockInterview({
      role: "Backend Engineer",
      track: "full_time",
      days: 5,
    });
    expect(suggestion.role).toBe("Backend Engineer");
    expect(suggestion.difficulty).toBe("medium");
    expect(suggestion.rounds).toEqual(["DSA", "CS Fundamentals", "HR"]);
    expect(suggestion.rounds.length).toBeGreaterThanOrEqual(2);
    expect(suggestion.rounds.length).toBeLessThanOrEqual(4);
  });

  it("maps specialist roles onto catalog round types", () => {
    expect(
      suggestGeneralMockInterview({ role: "AI/ML Engineer", track: "full_time", days: 4 })
        .rounds
    ).toContain("ML/AI Technical");
    expect(
      suggestGeneralMockInterview({ role: "VLSI intern", track: "summer_internship", days: 3 })
        .rounds
    ).toContain("Circuit Design");
    expect(
      suggestGeneralMockInterview({ role: "Data Analyst", track: "full_time", days: 4 }).rounds
    ).toContain("SQL");
    expect(
      suggestGeneralMockInterview({ role: "Consultant", track: "full_time", days: 4 }).rounds
    ).toContain("Case Interview");
  });

  it("suggests DSA when only coding questions exist (not OA)", () => {
    const suggestion = suggestGeneralMockInterview({
      role: "Software Engineer (SDE)",
      track: "full_time",
      days: 5,
      flags: { usedCoding: true },
    });
    expect(suggestion.rounds[0]).toBe("DSA");
    expect(suggestion.why).toMatch(/coding questions/);
    expect(suggestion.why).not.toMatch(/\bOA\b/);
  });

  it("uses easy when platform company data is thin", () => {
    const suggestion = suggestGeneralMockInterview({
      role: "SDE",
      track: "full_time",
      days: 5,
      limitedData: true,
    });
    expect(suggestion.difficulty).toBe("easy");
  });
});
