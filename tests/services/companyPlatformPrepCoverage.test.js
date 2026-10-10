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
      prepRoles: [
        { key: "sde", label: "SDE" },
        { key: "analyst", label: "Analyst" },
      ],
      onlineQuestions: [
        { status: "approved", question: "Two Sum", prepRoleKey: "sde" },
        { status: "pending", question: "Not yet", prepRoleKey: "sde" },
      ],
      mcqQuestions: [
        { status: "approved", question: "How many page faults?", prepRoleKey: "sde" },
        { status: "approved", question: "Which join?", prepRoleKey: "analyst" },
        { status: "pending", question: "Hidden MCQ", prepRoleKey: "analyst" },
      ],
      interviewQuestions: [
        { status: "approved", question: "What is REST?", prepRoleKey: "sde" },
        { status: "approved", question: "Explain OOP", prepRoleKey: "analyst" },
        { status: "approved", question: "System design", prepRoleKey: "analyst" },
        { status: "approved", question: "DBMS", prepRoleKey: "analyst" },
        { status: "approved", question: "OS", prepRoleKey: "analyst" },
      ],
      interviewExperiences: [
        { status: "approved", content: "Two rounds, then HR.", prepRoleKey: "sde" },
        { status: "approved", content: "DSA plus HR.", prepRoleKey: "analyst" },
      ],
      internshipExperiences: [
        { status: "approved", content: "PPO after intern.", prepRoleKey: "analyst" },
      ],
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
      oa: 3,
      interview: 5,
      experiences: 3,
    });
    expect(row.platformPrepCoverageByRole).toEqual([
      { key: "sde", label: "SDE", oa: 2, interview: 1, experiences: 1 },
      { key: "analyst", label: "Analyst", oa: 1, interview: 4, experiences: 2 },
    ]);
    expect(row.researchSources).toEqual([
      {
        prepRoleKey: "",
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
    expect(row.platformPrepCoverageByRole).toEqual([]);
    expect(row.researchSources).toEqual([]);
  });
});
