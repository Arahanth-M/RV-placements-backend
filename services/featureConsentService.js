import mongoose from "mongoose";
import User1 from "../models/User1.js";
import {
  FEATURE_CONSENT_ID_LIST,
  FEATURE_CONSENT_VERSIONS,
  isKnownFeatureConsentId,
} from "../config/featureConsents.js";

function toObjectId(id) {
  if (id == null) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

function entryFromDoc(feature, doc) {
  const requiredVersion = FEATURE_CONSENT_VERSIONS[feature] || "";
  const raw = doc?.featureConsents?.[feature];
  const version = String(raw?.version || "").trim();
  const acceptedAt = raw?.acceptedAt ? new Date(raw.acceptedAt) : null;
  const acceptedAtIso =
    acceptedAt && !Number.isNaN(acceptedAt.getTime())
      ? acceptedAt.toISOString()
      : null;
  const needsConsent = !acceptedAtIso || version !== requiredVersion;
  return {
    feature,
    acceptedAt: acceptedAtIso,
    version: version || null,
    requiredVersion,
    needsConsent,
  };
}

export function buildAllFeatureConsentStatuses(doc) {
  const out = {};
  for (const feature of FEATURE_CONSENT_ID_LIST) {
    out[feature] = entryFromDoc(feature, doc);
  }
  return out;
}

export async function getFeatureConsentStatuses(userId) {
  const uid = toObjectId(userId);
  if (!uid) return buildAllFeatureConsentStatuses(null);

  const doc = await User1.findById(uid).select("featureConsents").lean();
  return buildAllFeatureConsentStatuses(doc);
}

/**
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @param {string} feature
 * @returns {Promise<boolean>}
 */
export async function hasFeatureConsent(userId, feature) {
  const statuses = await getFeatureConsentStatuses(userId);
  const entry = statuses?.[String(feature || "").trim()];
  return entry ? entry.needsConsent !== true : false;
}

/**
 * Record affirmative acceptance for one feature consent.
 */
export async function acceptFeatureConsent(userId, feature, version) {
  const uid = toObjectId(userId);
  const featureId = String(feature || "").trim();
  const ver = String(version || "").trim();

  if (!uid) {
    return {
      ok: false,
      reason: "invalid_user",
      featureConsents: buildAllFeatureConsentStatuses(null),
    };
  }

  if (!isKnownFeatureConsentId(featureId)) {
    return {
      ok: false,
      reason: "unknown_feature",
      featureConsents: await getFeatureConsentStatuses(uid),
    };
  }

  const required = FEATURE_CONSENT_VERSIONS[featureId];
  if (!ver || ver !== required) {
    return {
      ok: false,
      reason: "version_mismatch",
      featureConsents: await getFeatureConsentStatuses(uid),
    };
  }

  const now = new Date();
  const doc = await User1.findByIdAndUpdate(
    uid,
    {
      $set: {
        [`featureConsents.${featureId}.acceptedAt`]: now,
        [`featureConsents.${featureId}.version`]: ver,
      },
    },
    { new: true, select: "featureConsents" }
  ).lean();

  if (!doc) {
    return {
      ok: false,
      reason: "not_found",
      featureConsents: buildAllFeatureConsentStatuses(null),
    };
  }

  return {
    ok: true,
    featureConsents: buildAllFeatureConsentStatuses(doc),
  };
}
