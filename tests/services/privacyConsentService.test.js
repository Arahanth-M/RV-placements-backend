import { describe, expect, it } from "@jest/globals";
import User1 from "../../models/User1.js";
import { PRIVACY_POLICY_VERSION } from "../../config/privacyPolicy.js";
import {
  acceptPrivacyConsent,
  buildPrivacyConsentStatus,
  getPrivacyConsentStatus,
} from "../../services/privacyConsentService.js";

describe("privacyConsentService", () => {
  it("buildPrivacyConsentStatus marks missing consent as needed", () => {
    const status = buildPrivacyConsentStatus(null);
    expect(status.needsConsent).toBe(true);
    expect(status.requiredPolicyVersion).toBe(PRIVACY_POLICY_VERSION);
    expect(status.acceptedAt).toBeNull();
  });

  it("acceptPrivacyConsent stores proof and clears needsConsent", async () => {
    const user = await User1.create({
      email: "privacy-student@example.com",
      username: "privacy-student",
      googleId: "g-privacy-1",
    });

    const before = await getPrivacyConsentStatus(user._id);
    expect(before.needsConsent).toBe(true);

    const result = await acceptPrivacyConsent(user._id, PRIVACY_POLICY_VERSION);
    expect(result.ok).toBe(true);
    expect(result.privacyConsent.needsConsent).toBe(false);
    expect(result.privacyConsent.policyVersion).toBe(PRIVACY_POLICY_VERSION);
    expect(result.privacyConsent.acceptedAt).toBeTruthy();

    const stored = await User1.findById(user._id)
      .select("privacyConsentAcceptedAt privacyPolicyVersion")
      .lean();
    expect(stored.privacyPolicyVersion).toBe(PRIVACY_POLICY_VERSION);
    expect(stored.privacyConsentAcceptedAt).toBeTruthy();
  });

  it("rejects mismatched policy version", async () => {
    const user = await User1.create({
      email: "privacy-student2@example.com",
      username: "privacy-student2",
      googleId: "g-privacy-2",
    });

    const result = await acceptPrivacyConsent(user._id, "1999-01-01");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("version_mismatch");
    expect(result.privacyConsent.needsConsent).toBe(true);
  });
});
