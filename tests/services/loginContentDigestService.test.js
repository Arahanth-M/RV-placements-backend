import { describe, it, expect } from "@jest/globals";
import {
  formatDigestSummary,
  digestMeetsShowThreshold,
  resolveDigestSince,
  pickDigestCursor,
  DIGEST_MAX_LOOKBACK_MS,
} from "../../services/loginContentDigestService.js";

describe("loginContentDigestService helpers", () => {
  it("returns null when previous login is missing or invalid", () => {
    expect(resolveDigestSince(null)).toBeNull();
    expect(resolveDigestSince("")).toBeNull();
    expect(resolveDigestSince("not-a-date")).toBeNull();
  });

  it("uses previous login when it is inside the lookback window", () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const previous = new Date("2026-08-20T12:00:00.000Z");
    expect(resolveDigestSince(previous.toISOString(), now).toISOString()).toBe(
      previous.toISOString()
    );
  });

  it("caps lookback so a long absence does not scan the whole catalog", () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const previous = new Date(now.getTime() - DIGEST_MAX_LOOKBACK_MS - 86_400_000);
    const since = resolveDigestSince(previous.toISOString(), now);
    expect(since.getTime()).toBe(now.getTime() - DIGEST_MAX_LOOKBACK_MS);
  });

  it("prefers the later of client last-seen and JWT previous login", () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const jwt = "2026-08-20T12:00:00.000Z";
    const client = "2026-08-21T12:00:00.000Z";
    expect(
      pickDigestCursor(
        { clientSince: client, previousLastLoginAt: jwt },
        now
      ).toISOString()
    ).toBe(client);
  });

  it("formats contribution counts without empty types", () => {
    expect(
      formatDigestSummary({
        onlineQuestions: 2,
        interviewQuestions: 1,
        interviewProcess: 0,
      })
    ).toBe("2 OA questions, 1 interview question");

    expect(
      formatDigestSummary({
        onlineQuestions: 1,
        interviewQuestions: 0,
        interviewProcess: 3,
      })
    ).toBe("1 OA question, 3 interview experiences");

    expect(
      formatDigestSummary({
        mustDoTopics: 2,
        recruitmentProcess: 1,
      })
    ).toBe("2 must-do topics, 1 recruitment process");
  });
});

describe("digestMeetsShowThreshold", () => {
  it("hides a single OA / interview question / must-do", () => {
    expect(
      digestMeetsShowThreshold([{ onlineQuestions: 1, interviewQuestions: 0, mustDoTopics: 0 }])
    ).toBe(false);
    expect(
      digestMeetsShowThreshold([{ onlineQuestions: 0, interviewQuestions: 1, mustDoTopics: 0 }])
    ).toBe(false);
    expect(
      digestMeetsShowThreshold([{ onlineQuestions: 0, interviewQuestions: 0, mustDoTopics: 1 }])
    ).toBe(false);
  });

  it("shows when two question-like items exist across companies", () => {
    expect(
      digestMeetsShowThreshold([
        { onlineQuestions: 1 },
        { mustDoTopics: 1 },
      ])
    ).toBe(true);
    expect(digestMeetsShowThreshold([{ interviewQuestions: 2 }])).toBe(true);
  });

  it("shows for one interview experience or one recruitment process", () => {
    expect(digestMeetsShowThreshold([{ interviewProcess: 1 }])).toBe(true);
    expect(digestMeetsShowThreshold([{ recruitmentProcess: 1 }])).toBe(true);
  });
});
