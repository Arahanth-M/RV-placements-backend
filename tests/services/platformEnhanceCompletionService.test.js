import CompanyPlatformContent from "../../models/CompanyPlatformContent.js";
import {
  normalizeEnhanceCompletionDoc,
  updatePlatformEnhanceCompletion,
} from "../../services/platformEnhanceCompletionService.js";
import { getCompanyPlatformDetailById } from "../../services/companyPlatformDetailService.js";
import { seedApprovedSplitCompany } from "../helpers/seedSplitCompany.js";

describe("platformEnhanceCompletionService", () => {
  it("persists OA enhance completion on the platform content doc", async () => {
    const { staticRow } = await seedApprovedSplitCompany({
      name: "Enhance Completion Co",
    });
    await CompanyPlatformContent.create({
      companyId: staticRow._id,
      onlineQuestions: [
        {
          kind: "coding",
          status: "approved",
          question: "Two Sum",
          answer: "hash map",
        },
      ],
    });

    const companyId = String(staticRow._id);
    const out = await updatePlatformEnhanceCompletion({
      companyId,
      scope: "oa",
      completion: {
        question: { passed: 1, remaining: 0, total: 1, complete: true },
        python: { passed: 0, remaining: 1, total: 1, complete: false },
      },
    });

    expect(out.platformEnhanceCompletion.oa.question.complete).toBe(true);
    expect(out.platformEnhanceCompletion.oa.python.remaining).toBe(1);

    const payload = await getCompanyPlatformDetailById(companyId);
    expect(payload.platformEnhanceCompletion.oa.question.complete).toBe(true);
    expect(payload.platformEnhanceCompletion.oa.python.remaining).toBe(1);
  });

  it("normalizes empty completion docs", () => {
    expect(normalizeEnhanceCompletionDoc(null)).toEqual({ oa: {}, interview: {} });
  });
});
