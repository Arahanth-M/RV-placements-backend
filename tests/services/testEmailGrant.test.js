import {
  isTestEmailGrantActive,
  parseTestEmailDuration,
  testEmailGrantStatus,
  usageAnchorFromGrant,
} from "../../services/testEmailService.js";

describe("test email grants", () => {
  const now = new Date("2026-10-17T12:00:00.000Z");

  it("accepts only the admin validity choices", () => {
    expect(parseTestEmailDuration(2)).toBe(2);
    expect(parseTestEmailDuration("6")).toBe(6);
    expect(parseTestEmailDuration(8)).toBe(8);
    expect(parseTestEmailDuration(12)).toBe(12);
    expect(parseTestEmailDuration(24)).toBe(24);
    expect(parseTestEmailDuration(4)).toBeNull();
    expect(parseTestEmailDuration("48")).toBeNull();
  });

  it("treats a grant as active only before expiry and before revoke", () => {
    const active = {
      expiresAt: new Date("2026-10-17T18:00:00.000Z"),
      revokedAt: null,
    };
    expect(isTestEmailGrantActive(active, now)).toBe(true);
    expect(testEmailGrantStatus(active, now)).toBe("active");

    const expired = { expiresAt: new Date("2026-10-17T11:00:00.000Z"), revokedAt: null };
    expect(isTestEmailGrantActive(expired, now)).toBe(false);
    expect(testEmailGrantStatus(expired, now)).toBe("expired");

    const revoked = {
      expiresAt: new Date("2026-10-17T18:00:00.000Z"),
      revokedAt: new Date("2026-10-17T13:00:00.000Z"),
    };
    expect(isTestEmailGrantActive(revoked, now)).toBe(false);
    expect(testEmailGrantStatus(revoked, now)).toBe("revoked");
  });

  it("keeps the original usage anchor when a window is renewed", () => {
    const first = new Date("2026-10-01T00:00:00.000Z");
    const renewed = new Date("2026-10-17T12:00:00.000Z");
    expect(
      usageAnchorFromGrant({
        usageAnchorAt: first,
        grantedAt: renewed,
        createdAt: first,
      }).toISOString()
    ).toBe(first.toISOString());
  });
});
