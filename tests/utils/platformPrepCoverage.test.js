import {
  countApprovedExperiences,
  countApprovedQuestions,
  EMPTY_PLATFORM_PREP_COVERAGE,
  platformPrepCoverageByRoleFromDoc,
  platformPrepCoverageFromDoc,
} from "../../utils/platformPrepCoverage.js";

describe("platformPrepCoverage", () => {
  it("counts approved questions and skips pending or empty ones", () => {
    expect(
      countApprovedQuestions([
        { status: "approved", question: "Two Sum" },
        { status: "pending", question: "Hidden" },
        { question: "Legacy with no status" },
        { status: "approved", question: "   " },
      ])
    ).toBe(2);
  });

  it("counts interview plus internship experiences", () => {
    expect(
      platformPrepCoverageFromDoc({
        onlineQuestions: [{ status: "approved", question: "OA 1" }],
        interviewQuestions: [
          { status: "approved", question: "REST?" },
          { status: "approved", question: "OOP?" },
        ],
        interviewExperiences: [{ status: "approved", content: "Two rounds." }],
        internshipExperiences: [{ status: "approved", content: "Summer intern." }],
      })
    ).toEqual({ oa: 1, interview: 2, experiences: 2 });
  });

  it("counts approved MCQs as OA questions for the company and each role", () => {
    const doc = {
      prepRoles: [
        { key: "sde", label: "SDE" },
        { key: "analyst", label: "Analyst" },
      ],
      onlineQuestions: [{ status: "approved", question: "Two Sum", prepRoleKey: "sde" }],
      mcqQuestions: [
        { status: "approved", question: "How many page faults?", prepRoleKey: "sde" },
        { status: "approved", question: "Which join?", prepRoleKey: "analyst" },
        { status: "pending", question: "Hidden MCQ", prepRoleKey: "analyst" },
        { status: "approved", question: "   ", prepRoleKey: "sde" },
      ],
    };
    expect(platformPrepCoverageFromDoc(doc)).toMatchObject({ oa: 3 });
    expect(platformPrepCoverageByRoleFromDoc(doc)).toEqual([
      { key: "sde", label: "SDE", oa: 2, interview: 0, experiences: 0 },
      { key: "analyst", label: "Analyst", oa: 1, interview: 0, experiences: 0 },
    ]);
  });

  it("returns zeros for an empty document", () => {
    expect(platformPrepCoverageFromDoc(null)).toEqual(EMPTY_PLATFORM_PREP_COVERAGE);
    expect(countApprovedExperiences(undefined)).toBe(0);
    expect(platformPrepCoverageByRoleFromDoc(null)).toEqual([]);
  });

  it("splits approved counts by role and keeps empty catalog roles", () => {
    expect(
      platformPrepCoverageByRoleFromDoc({
        prepRoles: [
          { key: "sde", label: "SDE" },
          { key: "analyst", label: "Analyst" },
        ],
        onlineQuestions: [
          { status: "approved", question: "Two Sum", prepRoleKey: "sde" },
          { status: "pending", question: "Hidden", prepRoleKey: "sde" },
          { status: "approved", question: "SQL join", prepRoleKey: "analyst" },
          { status: "approved", question: "Untagged OA", prepRoleKey: "" },
        ],
        interviewQuestions: [
          { status: "approved", question: "REST?", prepRoleKey: "sde" },
          { status: "approved", question: "   ", prepRoleKey: "analyst" },
        ],
        interviewExperiences: [
          { status: "approved", content: "Two rounds.", prepRoleKey: "sde" },
        ],
        internshipExperiences: [
          { status: "approved", content: "Summer intern.", prepRoleKey: "analyst" },
        ],
      })
    ).toEqual([
      { key: "sde", label: "SDE", oa: 1, interview: 1, experiences: 1 },
      { key: "analyst", label: "Analyst", oa: 1, interview: 0, experiences: 1 },
      { key: "", label: "General", oa: 1, interview: 0, experiences: 0 },
    ]);
  });
});
