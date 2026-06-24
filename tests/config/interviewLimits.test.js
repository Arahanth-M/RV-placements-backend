import {
  computeWeeklyInterviewEligibility,
  computeRollingWindowInterviewEligibility,
  buildInterviewLimitReachedMessage,
  getInterviewWeeklyLimitMaxForUser,
  isInterviewWeeklyLimitElevatedUser,
} from "../../config/interviewLimits.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * MS_PER_DAY;

describe("interview weekly limits", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("allows first interview", () => {
    const result = computeWeeklyInterviewEligibility({
      lastCompletedAt: null,
      now: new Date("2026-06-14T10:00:00.000Z"),
      cooldownMs: WEEK_MS,
    });

    expect(result.canStart).toBe(true);
    expect(result.nextAvailableAt).toBeNull();
  });

  test("blocks within one week of last completion", () => {
    const completedAt = new Date("2026-06-10T10:00:00.000Z");
    const now = new Date("2026-06-14T09:00:00.000Z");

    const result = computeWeeklyInterviewEligibility({
      lastCompletedAt: completedAt,
      now,
      cooldownMs: WEEK_MS,
    });

    expect(result.canStart).toBe(false);
    expect(result.nextAvailableAt.toISOString()).toBe(
      new Date(completedAt.getTime() + WEEK_MS).toISOString()
    );
  });

  test("allows interview exactly after one week", () => {
    const completedAt = new Date("2026-06-07T10:00:00.000Z");
    const now = new Date(completedAt.getTime() + WEEK_MS);

    const result = computeWeeklyInterviewEligibility({
      lastCompletedAt: completedAt,
      now,
      cooldownMs: WEEK_MS,
    });

    expect(result.canStart).toBe(true);
    expect(result.nextAvailableAt).toBeNull();
  });

  test("buildInterviewLimitReachedMessage includes next available date", () => {
    const message = buildInterviewLimitReachedMessage("2026-06-21T10:00:00.000Z");
    expect(message).toMatch(/one AI mock interview every 7 days/i);
    expect(message).toMatch(/available on/i);
  });

  test("buildInterviewLimitReachedMessage reflects elevated weekly max", () => {
    const message = buildInterviewLimitReachedMessage("2026-06-21T10:00:00.000Z", 3);
    expect(message).toMatch(/up to 3 AI mock interviews every 7 days/i);
  });

  test("rolling window allows elevated users until max reached", () => {
    const now = new Date("2026-06-14T10:00:00.000Z");
    const timestamps = [
      new Date("2026-06-10T10:00:00.000Z"),
      new Date("2026-06-12T10:00:00.000Z"),
    ];

    const result = computeRollingWindowInterviewEligibility({
      completedAtTimestamps: timestamps,
      now,
      windowMs: WEEK_MS,
      maxPerWindow: 3,
    });

    expect(result.canStart).toBe(true);
    expect(result.completionsInWindow).toBe(2);
  });

  test("rolling window blocks when max completions reached", () => {
    const now = new Date("2026-06-14T10:00:00.000Z");
    const timestamps = [
      new Date("2026-06-08T10:00:00.000Z"),
      new Date("2026-06-10T10:00:00.000Z"),
      new Date("2026-06-12T10:00:00.000Z"),
    ];

    const result = computeRollingWindowInterviewEligibility({
      completedAtTimestamps: timestamps,
      now,
      windowMs: WEEK_MS,
      maxPerWindow: 3,
    });

    expect(result.canStart).toBe(false);
    expect(result.completionsInWindow).toBe(3);
    expect(result.nextAvailableAt.toISOString()).toBe(
      new Date(timestamps[0].getTime() + WEEK_MS).toISOString()
    );
  });

  test("elevated allowlist resolves by userId or email", () => {
    process.env.INTERVIEW_WEEKLY_LIMIT_ELEVATED_USER_IDS = "user-123";
    process.env.INTERVIEW_WEEKLY_LIMIT_ELEVATED_EMAILS = "Tester@RVCE.edu.in";
    process.env.INTERVIEW_WEEKLY_LIMIT_ELEVATED_MAX = "5";

    expect(isInterviewWeeklyLimitElevatedUser({ userId: "user-123" })).toBe(true);
    expect(isInterviewWeeklyLimitElevatedUser({ email: "tester@rvce.edu.in" })).toBe(true);
    expect(isInterviewWeeklyLimitElevatedUser({ userId: "other" })).toBe(false);
    expect(getInterviewWeeklyLimitMaxForUser({ userId: "user-123" })).toBe(5);
    expect(getInterviewWeeklyLimitMaxForUser({ userId: "other" })).toBe(1);
  });
});
