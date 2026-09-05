import { describe, expect, it } from "@jest/globals";
import jwt from "jsonwebtoken";
import User1 from "../../models/User1.js";
import DauDayUser from "../../models/DauDayUser.js";
import BlockedLoginAttempt from "../../models/BlockedLoginAttempt.js";
import {
  emailDomainFromEmail,
  normalizeCollegeName,
  normalizeBlockedLoginFlow,
  recordBlockedLoginAttempt,
  signBlockedLoginIntentToken,
  submitBlockedLoginInterest,
  getBlockedLoginSummaryForAdmin,
  verifyBlockedLoginIntentToken,
  BLOCKED_LOGIN_INTENT_TYP,
} from "../../services/blockedLoginAttempts.js";

describe("blockedLoginAttempts helpers", () => {
  it("parses email domain", () => {
    expect(emailDomainFromEmail("Ada@Gmail.com")).toBe("gmail.com");
    expect(emailDomainFromEmail("bad")).toBe("");
    expect(emailDomainFromEmail("")).toBe("");
  });

  it("normalizes college name", () => {
    expect(normalizeCollegeName("  BMS  College  ")).toBe("BMS College");
    expect(normalizeCollegeName("")).toBe("");
  });

  it("normalizes oauth flow", () => {
    expect(normalizeBlockedLoginFlow("signup")).toBe("signup");
    expect(normalizeBlockedLoginFlow("admin")).toBe("admin");
    expect(normalizeBlockedLoginFlow("")).toBe("login");
  });
});

describe("blockedLoginAttempts persistence", () => {
  it("records a blocked Gmail and ignores allowed college emails", async () => {
    const blockedId = await recordBlockedLoginAttempt({
      email: "visitor@gmail.com",
      googleId: "g-1",
      displayName: "Visitor",
      flow: "login",
    });
    expect(blockedId).toMatch(/^[a-f0-9]{24}$/i);

    const allowedId = await recordBlockedLoginAttempt({
      email: "student@rvce.edu.in",
      googleId: "g-rvce",
      displayName: "Student",
    });
    expect(allowedId).toBe("");

    const rvitmId = await recordBlockedLoginAttempt({
      email: "name.cs22.rvitm@rvei.edu.in",
      googleId: "g-rvitm",
    });
    expect(rvitmId).toBe("");

    expect(await User1.countDocuments()).toBe(0);
    expect(await DauDayUser.countDocuments()).toBe(0);
    expect(await BlockedLoginAttempt.countDocuments()).toBe(1);
  });

  it("attaches college interest via a short-lived token without creating a user", async () => {
    const attemptId = await recordBlockedLoginAttempt({
      email: "other@yahoo.com",
      googleId: "g-2",
      displayName: "Other",
      flow: "signup",
    });
    const token = signBlockedLoginIntentToken(attemptId);
    expect(verifyBlockedLoginIntentToken(token)).toBe(attemptId);

    const result = await submitBlockedLoginInterest({
      token,
      collegeName: "  PES University  ",
    });
    expect(result).toEqual({
      ok: true,
      collegeName: "PES University",
      wantsPlatformAtCollege: true,
    });

    const row = await BlockedLoginAttempt.findById(attemptId).lean();
    expect(row.collegeName).toBe("PES University");
    expect(row.wantsPlatformAtCollege).toBe(true);
    expect(row.respondedAt).toBeTruthy();
    expect(await User1.countDocuments()).toBe(0);
    expect(await DauDayUser.countDocuments()).toBe(0);
  });

  it("rejects a normal session JWT as an interest token", () => {
    const sessionJwt = jwt.sign(
      { userId: "x", email: "a@gmail.com" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    expect(() => verifyBlockedLoginIntentToken(sessionJwt)).toThrow(
      /Invalid or expired interest token/
    );
  });

  it("rejects a token with the wrong typ even if signed with JWT_SECRET", () => {
    const fake = jwt.sign(
      { typ: "not_interest", attemptId: "507f1f77bcf86cd799439011" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );
    expect(() => verifyBlockedLoginIntentToken(fake)).toThrow(
      /Invalid or expired interest token/
    );
    expect(fake).not.toContain(BLOCKED_LOGIN_INTENT_TYP);
  });

  it("summarizes attempts for admin without touching users1", async () => {
    const id = await recordBlockedLoginAttempt({
      email: "campus@outlook.com",
      displayName: "Campus User",
    });
    await submitBlockedLoginInterest({
      token: signBlockedLoginIntentToken(id),
      collegeName: "MS Ramaiah",
      wantsPlatformAtCollege: true,
    });
    await recordBlockedLoginAttempt({
      email: "second@outlook.com",
      displayName: "Second",
    });

    const summary = await getBlockedLoginSummaryForAdmin(7);
    expect(summary.attemptCount).toBe(2);
    expect(summary.uniqueEmails).toBe(2);
    expect(summary.respondedCount).toBe(1);
    expect(summary.wantsPlatformCount).toBe(1);
    expect(summary.topColleges[0]).toEqual({ collegeName: "MS Ramaiah", count: 1 });
    expect(summary.topDomains[0]).toEqual({ domain: "outlook.com", count: 2 });
    expect(summary.recent).toHaveLength(2);
    expect(await User1.countDocuments()).toBe(0);
  });
});
