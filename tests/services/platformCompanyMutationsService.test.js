import CompanyPlatformContent from "../../models/CompanyPlatformContent.js";
import {
  updatePlatformExperience,
  updatePlatformQuestion,
} from "../../services/platformCompanyMutationsService.js";
import { getCompanyPlatformDetailById } from "../../services/companyPlatformDetailService.js";
import { seedApprovedSplitCompany } from "../helpers/seedSplitCompany.js";

describe("updatePlatformQuestion", () => {
  it("saves explanation, intuition, and every language solution", async () => {
    const { staticRow } = await seedApprovedSplitCompany({ name: "Edit Solutions Co" });
    await CompanyPlatformContent.create({
      companyId: staticRow._id,
      onlineQuestions: [
        {
          kind: "coding",
          status: "approved",
          question: "Two Sum",
          answer: "Old approach",
          intuition: "Old intuition",
          solutions: { cpp: "old cpp", java: "old java", python: "old python" },
        },
      ],
    });

    await updatePlatformQuestion(String(staticRow._id), "onlineQuestions", 0, {
      question: "Two Sum revised",
      explanation: "Walk both pointers.",
      intuition: "Sort, then scan.",
      solutions: {
        cpp: "cpp revised",
        java: "java revised",
        python: "python revised",
      },
    });

    const payload = await getCompanyPlatformDetailById(String(staticRow._id));
    expect(payload.onlineQuestions[0]).toBe("Two Sum revised");
    expect(payload.onlineQuestions_explanation[0]).toBe("Walk both pointers.");
    expect(payload.onlineQuestions_intuition[0]).toBe("Sort, then scan.");
    expect(payload.onlineQuestions_solutions[0]).toEqual({
      cpp: "cpp revised",
      java: "java revised",
      python: "python revised",
    });
  });
});

describe("updatePlatformExperience", () => {
  it("replaces the stored overview and rounds, not only the plain text", async () => {
    const { staticRow } = await seedApprovedSplitCompany({ name: "Edit Experience Co" });
    await CompanyPlatformContent.create({
      companyId: staticRow._id,
      interviewExperiences: [
        {
          status: "approved",
          prepRoleKey: "sde",
          content: "Old overview\n\nRound 1: OA\nOld title\n\nOld details",
          polishedContent: {
            overview: "Old overview",
            rounds: [{ order: 1, type: "OA", title: "Old title", details: "Old details" }],
          },
        },
      ],
    });

    await updatePlatformExperience(String(staticRow._id), "interviewExperiences", 0, {
      content: "New overview\n\nRound 1: Technical\nNew title\n\nNew details",
      polishedContent: {
        overview: "New overview",
        rounds: [{ order: 1, type: "Technical", title: "New title", details: "New details" }],
      },
    });

    const payload = await getCompanyPlatformDetailById(String(staticRow._id));
    expect(payload.interviewProcess[0].content).toContain("New overview");
    expect(payload.interviewProcess[0].polishedContent).toEqual({
      overview: "New overview",
      rounds: [{ order: 1, type: "Technical", title: "New title", details: "New details" }],
    });
    expect(payload.interviewProcess[0].prepRoleKey).toBe("sde");
  });
});
