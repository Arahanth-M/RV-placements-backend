import CompanyPlatformContent from "../../models/CompanyPlatformContent.js";
import { listPlatformPrepCatalog } from "../../services/platformPrepCatalogService.js";
import { seedApprovedSplitCompany } from "../helpers/seedSplitCompany.js";

describe("listPlatformPrepCatalog", () => {
  it("returns business model and coverage for every static company", async () => {
    const { staticRow: filled } = await seedApprovedSplitCompany({
      name: "Catalog Fintech",
      nameKey: "catalog-fintech",
      business_model: "Fintech",
    });
    await seedApprovedSplitCompany({
      name: "Catalog Empty",
      nameKey: "catalog-empty",
      business_model: "IT Services",
    });
    await CompanyPlatformContent.create({
      companyId: filled._id,
      onlineQuestions: [
        {
          status: "approved",
          question: "Two Sum",
          reviewedBy: { name: "Platform Admin", email: "admin@example.com" },
        },
      ],
      researchSources: [
        {
          title: "GFG",
          url: "https://www.geeksforgeeks.org/catalog-fintech",
          snippet: "OA notes",
        },
      ],
      interviewQuestions: [],
      interviewExperiences: [],
      internshipExperiences: [],
    });
    const { staticRow: submitted } = await seedApprovedSplitCompany({
      name: "Catalog Submitted",
      nameKey: "catalog-submitted",
      business_model: "Fintech",
    });
    await CompanyPlatformContent.create({
      companyId: submitted._id,
      onlineQuestions: [
        {
          status: "approved",
          question: "Student question",
          submittedBy: { name: "Student", email: "student@gmail.com" },
        },
      ],
    });

    const list = await listPlatformPrepCatalog();
    const fintech = list.find((row) => row.name === "Catalog Fintech");
    const empty = list.find((row) => row.name === "Catalog Empty");
    const studentOnly = list.find((row) => row.name === "Catalog Submitted");

    expect(fintech).toMatchObject({
      business_model: "Fintech",
      platformPrepCoverage: { oa: 1, interview: 0, experiences: 0 },
      researchPipelineAdded: true,
    });
    expect(empty).toMatchObject({
      business_model: "IT Services",
      platformPrepCoverage: { oa: 0, interview: 0, experiences: 0 },
      researchPipelineAdded: false,
    });
    expect(studentOnly).toMatchObject({
      researchPipelineAdded: false,
      platformPrepCoverage: { oa: 1, interview: 0, experiences: 0 },
    });
    expect(fintech.platformPrepCoverageByRole).toBeUndefined();
  });
});
