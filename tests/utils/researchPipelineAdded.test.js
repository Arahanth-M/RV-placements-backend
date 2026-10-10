import { companyHasResearchPipelineContent } from "../../utils/researchPipelineAdded.js";

const reviewer = { name: "Platform Admin", email: "admin@example.com" };
const student = { name: "Student", email: "student@gmail.com" };

describe("companyHasResearchPipelineContent", () => {
  it("counts published research links and generated questions", () => {
    expect(
      companyHasResearchPipelineContent({
        researchSources: [{ url: "https://www.geeksforgeeks.org/acme" }],
      })
    ).toBe(true);
    expect(
      companyHasResearchPipelineContent({
        researchLinksSummaries: [{ summary: "OA is coding plus SQL." }],
      })
    ).toBe(true);
    expect(
      companyHasResearchPipelineContent({
        onlineQuestions: [
          { question: "Two Sum", status: "approved", reviewedBy: reviewer },
        ],
      })
    ).toBe(true);
  });

  it("ignores student submissions and empty companies", () => {
    expect(
      companyHasResearchPipelineContent({
        onlineQuestions: [
          {
            question: "Two Sum",
            status: "approved",
            submittedBy: student,
            reviewedBy: reviewer,
          },
        ],
        interviewExperiences: [
          { content: "Three rounds.", status: "approved", submittedBy: student },
        ],
      })
    ).toBe(false);
    expect(companyHasResearchPipelineContent(null)).toBe(false);
    expect(companyHasResearchPipelineContent({ onlineQuestions: [] })).toBe(false);
  });
});
