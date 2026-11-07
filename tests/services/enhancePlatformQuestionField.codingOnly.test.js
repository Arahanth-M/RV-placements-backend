import CompanyPlatformContent from "../../models/CompanyPlatformContent.js";
import { enhancePlatformQuestionField } from "../../services/enhancePlatformQuestionField.js";
import { getCompanyPlatformDetailById } from "../../services/companyPlatformDetailService.js";
import { seedApprovedSplitCompany } from "../helpers/seedSplitCompany.js";

describe("enhancePlatformQuestionField coding-only fields", () => {
  it("skips intuition and language refills for non-coding questions", async () => {
    const { staticRow } = await seedApprovedSplitCompany({
      name: "Enhance Coding Only Co",
    });
    await CompanyPlatformContent.create({
      companyId: staticRow._id,
      onlineQuestions: [
        {
          kind: "non_coding",
          status: "approved",
          question: "What is CAP theorem?",
          answer: "Consistency, Availability, Partition tolerance.",
          intuition: "should stay",
          solutions: { cpp: "old", java: "old", python: "old" },
        },
      ],
    });

    const companyId = String(staticRow._id);
    for (const field of ["intuition", "cpp", "java", "python"]) {
      const out = await enhancePlatformQuestionField({
        companyId,
        contentField: "onlineQuestions",
        index: 0,
        field,
      });
      expect(out.skipped).toBe(true);
      expect(out.reason).toBe("not_coding");
    }

    const payload = await getCompanyPlatformDetailById(companyId);
    expect(payload.onlineQuestions_intuition[0]).toBe("should stay");
    expect(payload.onlineQuestions_solutions[0]).toEqual({
      cpp: "old",
      java: "old",
      python: "old",
    });
  });
});
