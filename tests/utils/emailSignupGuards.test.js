import { jest } from "@jest/globals";

describe("emailSignupGuards", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EXTRA_DISPOSABLE_EMAIL_DOMAINS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("detects common disposable domains and subdomains", async () => {
    const { isDisposableEmail } = await import("../../utils/emailSignupGuards.js");
    expect(isDisposableEmail("user@mailinator.com")).toBe(true);
    expect(isDisposableEmail("user@guerrillamail.com")).toBe(true);
    expect(isDisposableEmail("user@10minutemail.com")).toBe(true);
    expect(isDisposableEmail("user@foo.mailinator.com")).toBe(true);
  });

  it("allows normal providers and college emails", async () => {
    const { isDisposableEmail } = await import("../../utils/emailSignupGuards.js");
    expect(isDisposableEmail("student@gmail.com")).toBe(false);
    expect(isDisposableEmail("student@outlook.com")).toBe(false);
    expect(isDisposableEmail("usn@rvce.edu.in")).toBe(false);
  });

  it("supports EXTRA_DISPOSABLE_EMAIL_DOMAINS overrides", async () => {
    process.env.EXTRA_DISPOSABLE_EMAIL_DOMAINS = "spamtest.example,another.fake";
    const {
      isDisposableEmail,
      resetDisposableDomainCacheForTests,
    } = await import("../../utils/emailSignupGuards.js");
    resetDisposableDomainCacheForTests();
    expect(isDisposableEmail("a@spamtest.example")).toBe(true);
    expect(isDisposableEmail("b@another.fake")).toBe(true);
    expect(isDisposableEmail("c@gmail.com")).toBe(false);
  });

  it("reads Google email verification from passport profile shapes", async () => {
    const { isGoogleEmailVerified } = await import(
      "../../utils/emailSignupGuards.js"
    );
    expect(
      isGoogleEmailVerified({
        emails: [{ value: "a@gmail.com", verified: true }],
      })
    ).toBe(true);
    expect(
      isGoogleEmailVerified({
        emails: [{ value: "a@gmail.com", verified: "true" }],
      })
    ).toBe(true);
    expect(
      isGoogleEmailVerified({
        emails: [{ value: "a@gmail.com", verified: false }],
        _json: { email_verified: true },
      })
    ).toBe(true);
    expect(
      isGoogleEmailVerified({
        emails: [{ value: "a@gmail.com", verified: false }],
        _json: { email_verified: false },
      })
    ).toBe(false);
    expect(isGoogleEmailVerified({})).toBe(false);
  });
});
