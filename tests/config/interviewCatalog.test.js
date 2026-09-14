import {
  CAMPUS_INTERVIEW_ROUND_TYPES,
  PLATFORM_FRESHER_ROLES,
  PLATFORM_INTERVIEW_ROUND_TYPES,
} from "../../config/interviewCatalog.js";
import { interviewStartSchema } from "../../validations/interview.validation.js";
import { generateInterviewPlanFromCustomRounds } from "../../services/interviewEngine.js";
import { roundTypeImpliesCodeExecutionInterview } from "../../services/interviewCodeGradingGuards.js";

describe("general interview catalog", () => {
  it("keeps the platform catalog bounded to 15 fresher roles and 13 round types", () => {
    expect(PLATFORM_FRESHER_ROLES).toHaveLength(15);
    expect(PLATFORM_INTERVIEW_ROUND_TYPES).toHaveLength(13);
    expect(PLATFORM_INTERVIEW_ROUND_TYPES).toEqual(
      expect.arrayContaining(CAMPUS_INTERVIEW_ROUND_TYPES)
    );
  });

  it("requires a fixed role and global difficulty for platform starts", () => {
    const { error } = interviewStartSchema.validate({
      companyId: "507f1f77bcf86cd799439011",
      contentScope: "platform",
      role: "AI/ML Engineer",
      interviewDifficulty: "hard",
      customRounds: [{ type: "ML/AI Technical", difficulty: "easy" }],
    });

    expect(error).toBeUndefined();

    const missingRole = interviewStartSchema.validate({
      companyId: "507f1f77bcf86cd799439011",
      contentScope: "platform",
      interviewDifficulty: "medium",
      customRounds: [{ type: "Aptitude", difficulty: "medium" }],
    });
    expect(missingRole.error).toBeDefined();
  });

  it("allows platform-only rounds without forcing HR", async () => {
    const plan = await generateInterviewPlanFromCustomRounds(
      [{ type: "Circuit Design", difficulty: "medium" }],
      { platform: true }
    );

    expect(plan.rounds).toHaveLength(1);
    expect(plan.rounds[0]).toMatchObject({
      type: "Circuit Design",
      difficulty: "medium",
    });
  });

  it("keeps platform-only rounds and the no-HR plan out of campus interviews", async () => {
    await expect(
      generateInterviewPlanFromCustomRounds(
        [{ type: "Circuit Design", difficulty: "medium" }],
        { platform: false }
      )
    ).rejects.toThrow("not available");

    await expect(
      generateInterviewPlanFromCustomRounds(
        [{ type: "DSA", difficulty: "medium" }],
        { platform: false }
      )
    ).rejects.toThrow("At least one HR round");
  });

  it("does not misclassify technical theory rounds as executable coding", () => {
    expect(roundTypeImpliesCodeExecutionInterview("DSA")).toBe(true);
    expect(roundTypeImpliesCodeExecutionInterview("Core Technical")).toBe(false);
    expect(roundTypeImpliesCodeExecutionInterview("ML/AI Technical")).toBe(false);
  });
});
