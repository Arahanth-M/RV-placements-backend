import {
  computeWeeklyInterviewEligibility,
  buildInterviewLimitReachedMessage,
} from "../../config/interviewLimits.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * MS_PER_DAY;

describe("interview weekly limits", () => {
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
});
