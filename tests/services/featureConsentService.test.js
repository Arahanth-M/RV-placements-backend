import { describe, expect, it } from "@jest/globals";
import User1 from "../../models/User1.js";
import {
  FEATURE_CONSENT_IDS,
  FEATURE_CONSENT_VERSIONS,
} from "../../config/featureConsents.js";
import {
  acceptFeatureConsent,
  buildAllFeatureConsentStatuses,
  getFeatureConsentStatuses,
} from "../../services/featureConsentService.js";

describe("featureConsentService", () => {
  it("marks all features as needing consent when empty", () => {
    const status = buildAllFeatureConsentStatuses(null);
    expect(status.aiInterview.needsConsent).toBe(true);
    expect(status.billingCheckout.needsConsent).toBe(true);
  });

  it("accepts AI interview consent and stores proof", async () => {
    const user = await User1.create({
      email: "feature-consent@example.com",
      username: "feature-consent",
      googleId: "g-feature-1",
    });

    const before = await getFeatureConsentStatuses(user._id);
    expect(before.aiInterview.needsConsent).toBe(true);

    const result = await acceptFeatureConsent(
      user._id,
      FEATURE_CONSENT_IDS.AI_INTERVIEW,
      FEATURE_CONSENT_VERSIONS[FEATURE_CONSENT_IDS.AI_INTERVIEW]
    );
    expect(result.ok).toBe(true);
    expect(result.featureConsents.aiInterview.needsConsent).toBe(false);
    expect(result.featureConsents.billingCheckout.needsConsent).toBe(true);

    const stored = await User1.findById(user._id).select("featureConsents").lean();
    expect(stored.featureConsents.aiInterview.version).toBe(
      FEATURE_CONSENT_VERSIONS[FEATURE_CONSENT_IDS.AI_INTERVIEW]
    );
  });

  it("rejects unknown feature or version mismatch", async () => {
    const user = await User1.create({
      email: "feature-consent2@example.com",
      username: "feature-consent2",
      googleId: "g-feature-2",
    });

    const badFeature = await acceptFeatureConsent(user._id, "nope", "2026-11-13");
    expect(badFeature.ok).toBe(false);
    expect(badFeature.reason).toBe("unknown_feature");

    const badVersion = await acceptFeatureConsent(
      user._id,
      FEATURE_CONSENT_IDS.BILLING_CHECKOUT,
      "1999-01-01"
    );
    expect(badVersion.ok).toBe(false);
    expect(badVersion.reason).toBe("version_mismatch");
  });

  it("accepts prepPath and behavioralCoach consents", async () => {
    const user = await User1.create({
      email: "feature-consent3@example.com",
      username: "feature-consent3",
      googleId: "g-feature-3",
    });

    const prep = await acceptFeatureConsent(
      user._id,
      FEATURE_CONSENT_IDS.PREP_PATH,
      FEATURE_CONSENT_VERSIONS[FEATURE_CONSENT_IDS.PREP_PATH]
    );
    expect(prep.ok).toBe(true);
    expect(prep.featureConsents.prepPath.needsConsent).toBe(false);

    const coach = await acceptFeatureConsent(
      user._id,
      FEATURE_CONSENT_IDS.BEHAVIORAL_COACH,
      FEATURE_CONSENT_VERSIONS[FEATURE_CONSENT_IDS.BEHAVIORAL_COACH]
    );
    expect(coach.ok).toBe(true);
    expect(coach.featureConsents.behavioralCoach.needsConsent).toBe(false);
  });
});
