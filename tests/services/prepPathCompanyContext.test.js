import CompanyPlatformContent from "../../models/CompanyPlatformContent.js";
import CompanyStatic from "../../models/CompanyStatic.js";
import CompanyVisit from "../../models/CompanyVisit.js";
import {
  formatCompanyContextForPrompt,
  loadCompanyPrepContext,
} from "../../services/prepPath/companyContext.js";
import { formatEvidenceLabel } from "../../services/prepPath/campusEvidence.js";
import { seedApprovedSplitCompany } from "../helpers/seedSplitCompany.js";

async function seedSplitCompanyWithCampusAndPlatform() {
  const { staticRow, visit } = await seedApprovedSplitCompany({
    name: "PrepPath Split Co",
    about: "Builds backup software.",
    business_model: "SaaS",
  });
  await CompanyVisit.updateOne(
    { _id: visit._id },
    {
      $set: {
        onlineQuestions: ["Campus-only OA"],
        interviewQuestions: ["Campus-only interview Q"],
        interviewProcess: ["Campus-only experience"],
        must_do_topics: ["Campus-only topic"],
        roles: [{ roleName: "Campus SDE", skills: ["Campus C++"] }],
      },
    }
  );
  await CompanyPlatformContent.create({
    companyId: staticRow._id,
    onlineQuestions: [
      {
        kind: "coding",
        status: "approved",
        question: "Platform OA Two Sum",
      },
    ],
    interviewQuestions: [
      {
        kind: "non_coding",
        status: "approved",
        question: "Platform REST question",
      },
    ],
    interviewExperiences: [
      { status: "approved", content: "Platform two rounds then HR." },
    ],
    internshipExperiences: [
      { status: "approved", content: "Platform intern manager round." },
    ],
    mustDoTopics: [{ status: "approved", topic: "Platform Arrays" }],
  });
  return { staticRow, visit };
}

describe("loadCompanyPrepContext", () => {
  it("uses /general platform content and ignores campus visits when scope=platform", async () => {
    const { staticRow } = await seedSplitCompanyWithCampusAndPlatform();

    const ctx = await loadCompanyPrepContext(String(staticRow._id), {
      track: "full_time",
      scope: "platform",
      collegeId: "rvce",
    });

    expect(ctx.contentSource).toBe("platform");
    expect(ctx.visitYears).toEqual([]);
    expect(ctx.roles).toEqual([]);
    expect(ctx.mustDoTopics).toContain("Platform Arrays");
    expect(ctx.mustDoTopics).not.toContain("Campus-only topic");
    expect(ctx.onlineQuestions).toContain("Platform OA Two Sum");
    expect(ctx.onlineQuestions).not.toContain("Campus-only OA");
    expect(ctx.interviewQuestions).toContain("Platform REST question");
    expect(ctx.interviewQuestions).not.toContain("Campus-only interview Q");
    expect(ctx.interviewProcess).toContain("Platform two rounds then HR.");
    expect(ctx.interviewProcess).not.toContain("Campus-only experience");
    expect(ctx.sources[0].title).toContain("/general prep data");

    const prompt = formatCompanyContextForPrompt(ctx, { targetRole: "SDE" });
    expect(prompt).toContain("/general platform evidence");
    expect(prompt).not.toContain("Campus-only OA");
    expect(prompt).toContain("Platform OA Two Sum");
  });

  it("still loads campus visits when scope is not platform", async () => {
    const { staticRow } = await seedSplitCompanyWithCampusAndPlatform();

    const ctx = await loadCompanyPrepContext(String(staticRow._id), {
      track: "full_time",
      collegeId: "rvce",
    });

    expect(ctx.contentSource).toBe("campus");
    expect(ctx.onlineQuestions).toContain("Campus-only OA");
    expect(ctx.onlineQuestions).not.toContain("Platform OA Two Sum");
    expect(ctx.mustDoTopics).toContain("Campus-only topic");
    expect(ctx.roles).toContain("Campus SDE");
    expect(ctx.sources[0].title).toContain("campus prep data");

    const prompt = formatCompanyContextForPrompt(ctx, { targetRole: "SDE" });
    expect(prompt).toContain("Campus evidence");
    expect(prompt).toContain("Campus-only OA");
    expect(prompt).not.toContain("Platform OA Two Sum");
  });

  it("prefers internship experiences on /general summer track", async () => {
    const { staticRow } = await seedSplitCompanyWithCampusAndPlatform();

    const ctx = await loadCompanyPrepContext(String(staticRow._id), {
      track: "summer_internship",
      scope: "platform",
    });

    expect(ctx.contentSource).toBe("platform");
    expect(ctx.trackMatched).toBe(true);
    expect(ctx.interviewProcess).toContain("Platform intern manager round.");
    expect(ctx.interviewProcess).not.toContain("Campus-only experience");
  });
});

describe("formatEvidenceLabel", () => {
  it("labels /general evidence as platform, not RVCE visits", () => {
    expect(
      formatEvidenceLabel({ sourceType: "oa", text: "Two Sum" }, { contentSource: "platform" })
    ).toBe("Seen on the platform: OA");
    expect(
      formatEvidenceLabel({ sourceType: "coding", text: "Two Sum" }, { contentSource: "platform" })
    ).toBe("Seen on the platform: Coding");
    expect(formatEvidenceLabel({ sourceType: "must_do" })).toBe(
      "Seen in RVCE visit data: Must-do"
    );
  });
});

describe("OA vs coding evidence split", () => {
  it("does not mark usedOA when only coding questions exist on /general", async () => {
    const { staticRow } = await seedApprovedSplitCompany({
      name: "Coding Only Co",
      about: "Builds tools.",
      business_model: "SaaS",
    });
    await CompanyPlatformContent.create({
      companyId: staticRow._id,
      onlineQuestions: [],
      codingQuestions: [
        {
          status: "approved",
          question: { Title: "Platform coding Two Sum" },
        },
      ],
    });

    const ctx = await loadCompanyPrepContext(String(staticRow._id), {
      track: "full_time",
      scope: "platform",
    });

    expect(ctx.flags.usedOA).toBe(false);
    expect(ctx.flags.usedCoding).toBe(true);
    expect(ctx.onlineQuestions).toEqual([]);
    expect(ctx.prevCodingQuestions).toContain("Platform coding Two Sum");
    expect(ctx.evidenceBank.some((e) => e.sourceType === "coding")).toBe(true);
    expect(ctx.evidenceBank.some((e) => e.sourceType === "oa")).toBe(false);
  });

  it("keeps campus visit OA separate from static coding questions", async () => {
    const { staticRow, visit } = await seedApprovedSplitCompany({
      name: "Campus OA Coding Co",
      about: "Builds infra.",
      business_model: "SaaS",
    });
    await CompanyStatic.updateOne(
      { _id: staticRow._id },
      {
        $set: {
          prev_coding_ques: [{ title: "Static coding LRU Cache" }],
        },
      }
    );
    await CompanyVisit.updateOne(
      { _id: visit._id },
      { $set: { onlineQuestions: ["Visit OA graph question"] } }
    );

    const ctx = await loadCompanyPrepContext(String(staticRow._id), {
      track: "full_time",
      collegeId: "rvce",
    });

    expect(ctx.flags.usedOA).toBe(true);
    expect(ctx.flags.usedCoding).toBe(true);
    expect(ctx.onlineQuestions).toContain("Visit OA graph question");
    expect(ctx.prevCodingQuestions).toContain("Static coding LRU Cache");
    expect(
      ctx.evidenceBank.filter((e) => e.sourceType === "oa").map((e) => e.text)
    ).not.toContain("Static coding LRU Cache");
    expect(
      ctx.evidenceBank.filter((e) => e.sourceType === "coding").map((e) => e.text)
    ).toContain("Static coding LRU Cache");
  });
});
