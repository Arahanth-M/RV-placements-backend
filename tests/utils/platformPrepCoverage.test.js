import {
  countApprovedExperiences,
  countApprovedQuestions,
  EMPTY_PLATFORM_PREP_COVERAGE,
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

  it("returns zeros for an empty document", () => {
    expect(platformPrepCoverageFromDoc(null)).toEqual(EMPTY_PLATFORM_PREP_COVERAGE);
    expect(countApprovedExperiences(undefined)).toBe(0);
  });
});
