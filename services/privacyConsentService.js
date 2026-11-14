import mongoose from "mongoose";
import User1 from "../models/User1.js";
import { PRIVACY_POLICY_VERSION } from "../config/privacyPolicy.js";

function toObjectId(id) {
  if (id == null) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

export function buildPrivacyConsentStatus(doc) {
  const requiredPolicyVersion = PRIVACY_POLICY_VERSION;
  const policyVersion = String(doc?.privacyPolicyVersion || "").trim();
  const acceptedAt = doc?.privacyConsentAcceptedAt
    ? new Date(doc.privacyConsentAcceptedAt)
    : null;
  const acceptedAtIso =
    acceptedAt && !Number.isNaN(acceptedAt.getTime())
      ? acceptedAt.toISOString()
      : null;
  const needsConsent =
    !acceptedAtIso || policyVersion !== requiredPolicyVersion;

  return {
    acceptedAt: acceptedAtIso,
    policyVersion: policyVersion || null,
    requiredPolicyVersion,
    needsConsent,
  };
}

/**
 * Load consent status for a User1 id (JWT `_id`).
 * @param {string|import("mongoose").Types.ObjectId} userId
 */
export async function getPrivacyConsentStatus(userId) {
  const uid = toObjectId(userId);
  if (!uid) {
    return buildPrivacyConsentStatus(null);
  }

  const doc = await User1.findById(uid)
    .select("privacyConsentAcceptedAt privacyPolicyVersion")
    .lean();

  return buildPrivacyConsentStatus(doc);
}

/**
 * Record affirmative acceptance of the current privacy notice version.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @param {string} privacyPolicyVersion
 */
export async function acceptPrivacyConsent(userId, privacyPolicyVersion) {
  const uid = toObjectId(userId);
  const version = String(privacyPolicyVersion || "").trim();

  if (!uid) {
    return { ok: false, reason: "invalid_user", privacyConsent: buildPrivacyConsentStatus(null) };
  }

  if (!version) {
    return {
      ok: false,
      reason: "missing_version",
      privacyConsent: await getPrivacyConsentStatus(uid),
    };
  }

  if (version !== PRIVACY_POLICY_VERSION) {
    return {
      ok: false,
      reason: "version_mismatch",
      privacyConsent: await getPrivacyConsentStatus(uid),
    };
  }

  const now = new Date();
  const doc = await User1.findByIdAndUpdate(
    uid,
    {
      $set: {
        privacyConsentAcceptedAt: now,
        privacyPolicyVersion: version,
      },
    },
    {
      new: true,
      select: "privacyConsentAcceptedAt privacyPolicyVersion",
    }
  ).lean();

  if (!doc) {
    return {
      ok: false,
      reason: "not_found",
      privacyConsent: buildPrivacyConsentStatus(null),
    };
  }

  return {
    ok: true,
    privacyConsent: buildPrivacyConsentStatus(doc),
  };
}
