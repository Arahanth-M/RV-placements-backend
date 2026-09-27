import CompanyPlatformContent from "../../models/CompanyPlatformContent.js";
import { attachPlatformPrepCoverageToCompanyList } from "../../services/companyPlatformPrepCoverage.js";
import { seedApprovedSplitCompany } from "../helpers/seedSplitCompany.js";

describe("attachPlatformPrepCoverageToCompanyList", () => {
  it("attaches OA, interview, and experience counts from platform content", async () => {
    const { staticRow } = await seedApprovedSplitCompany({
      name: "Coverage Co",
      business_model: "SaaS",
    });
    await CompanyPlatformContent.create({
      companyId: staticRow._id,
      onlineQuestions: [
        { status: "approved", question: "Two Sum" },
        { status: "pending", question: "Not yet" },
      ],
      interviewQuestions: [
        { status: "approved", question: "What is REST?" },
        { status: "approved", question: "Explain OOP" },
        { status: "approved", question: "System design" },
        { status: "approved", question: "DBMS" },
        { status: "approved", question: "OS" },
      ],
      interviewExperiences: [
        { status: "approved", content: "Two rounds, then HR." },
        { status: "approved", content: "DSA plus HR." },
      ],
      internshipExperiences: [{ status: "approved", content: "PPO after intern." }],
      researchSources: [
        {
          title: "GFG Interview",
          url: "https://www.geeksforgeeks.org/walmart",
          snippet: "Prep notes",
          score: 0.88,
        },
      ],
    });

    const [row] = await attachPlatformPrepCoverageToCompanyList([
      { _id: staticRow._id, name: "Coverage Co" },
    ]);
    expect(row.platformPrepCoverage).toEqual({
      oa: 1,
      interview: 5,
      experiences: 3,
    });
    expect(row.researchSources).toEqual([
      {
        title: "GFG Interview",
        url: "https://www.geeksforgeeks.org/walmart",
        snippet: "Prep notes",
        score: 0.88,
      },
    ]);
  });

  it("uses zeros when a company has no platform document", async () => {
    const { staticRow } = await seedApprovedSplitCompany({
      name: "Empty Coverage Co",
    });
    const [row] = await attachPlatformPrepCoverageToCompanyList([
      { _id: String(staticRow._id), name: "Empty Coverage Co" },
    ]);
    expect(row.platformPrepCoverage).toEqual({
      oa: 0,
      interview: 0,
      experiences: 0,
    });
    expect(row.researchSources).toEqual([]);
  });
});
