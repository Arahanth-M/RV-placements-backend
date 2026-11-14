/**
 * Feature-level DPDP consents for the general platform.
 * Keep versions in sync with frontend `FEATURE_CONSENT_VERSIONS`
 * (RV-placements-frontend/src/constants/featureConsents.js).
 */
export const FEATURE_CONSENT_IDS = Object.freeze({
  AI_INTERVIEW: "aiInterview",
  BILLING_CHECKOUT: "billingCheckout",
  PREP_PATH: "prepPath",
  BEHAVIORAL_COACH: "behavioralCoach",
});

export const FEATURE_CONSENT_VERSIONS = Object.freeze({
  [FEATURE_CONSENT_IDS.AI_INTERVIEW]: "2026-11-13",
  [FEATURE_CONSENT_IDS.BILLING_CHECKOUT]: "2026-11-13",
  [FEATURE_CONSENT_IDS.PREP_PATH]: "2026-11-13",
  [FEATURE_CONSENT_IDS.BEHAVIORAL_COACH]: "2026-11-13",
});

export const FEATURE_CONSENT_ID_LIST = Object.freeze(
  Object.values(FEATURE_CONSENT_IDS)
);

export function isKnownFeatureConsentId(feature) {
  return FEATURE_CONSENT_ID_LIST.includes(String(feature || "").trim());
}
