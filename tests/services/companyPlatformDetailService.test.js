import CompanyPlatformContent from "../../models/CompanyPlatformContent.js";
import { getCompanyPlatformDetailById } from "../../services/companyPlatformDetailService.js";
import { seedApprovedSplitCompany } from "../helpers/seedSplitCompany.js";

describe("getCompanyPlatformDetailById", () => {
  it("maps platform prep without visit years or campus roles", async () => {
    const { staticRow } = await seedApprovedSplitCompany({
      name: "Platform Detail Co",
      business_model: "SaaS",
      about: "Cohesity builds backup software.",
    });
    await CompanyPlatformContent.create({
      companyId: staticRow._id,
      onlineQuestions: [
        {
          kind: "coding",
          status: "approved",
          question: "Two Sum",
          solutions: { cpp: "cpp-code", java: "java-code", python: "py-code" },
          intuition: "hash map",
        },
      ],
      interviewQuestions: [
        {
          kind: "non_coding",
          status: "approved",
          question: "What is REST?",
          answer: "HTTP API style",
        },
      ],
      interviewExperiences: [
        { status: "approved", content: "Two rounds, then HR." },
      ],
      mustDoTopics: [{ status: "approved", topic: "Arrays" }],
    });

    const payload = await getCompanyPlatformDetailById(String(staticRow._id));
    expect(payload.contentSource).toBe("platform");
    expect(payload.name).toBe("Platform Detail Co");
    expect(payload.about).toBe("Cohesity builds backup software.");
    expect(payload["About The Company"]).toBe("Cohesity builds backup software.");
    expect(payload.placementYearsAvailable).toEqual([]);
    expect(payload.roles).toEqual([]);
    expect(payload.onlineQuestions).toEqual(["Two Sum"]);
    expect(payload.onlineQuestions_solutions[0]).toEqual({
      cpp: "cpp-code",
      java: "java-code",
      python: "py-code",
    });
    expect(payload.onlineQuestions_intuition[0]).toBe("hash map");
    expect(payload.interviewQuestions).toEqual(["What is REST?"]);
    expect(payload.interviewProcess[0].content).toBe("Two rounds, then HR.");
    expect(payload.Must_Do_Topics).toContain("Arrays");
    expect(payload.prev_coding_ques).toEqual([]);
  });

  it("returns null for an unknown company id", async () => {
    const payload = await getCompanyPlatformDetailById("64b0f0f0f0f0f0f0f0f0f0f0");
    expect(payload).toBeNull();
  });
});
