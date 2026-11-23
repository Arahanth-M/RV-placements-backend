import UserPrepResumeDigest from "../../models/UserPrepResumeDigest.js";
import PrepPathPlan from "../../models/PrepPathPlan.js";
import { digestToFields } from "./resumeDigestFields.js";

/** Cap saved digests per user (oldest dropped when exceeded). */
export const MAX_USER_PREP_RESUME_DIGESTS = 10;

function asMeta(meta = {}) {
  return {
    fileName: String(meta?.fileName || "").trim().slice(0, 200),
    mime: String(meta?.mime || "").trim().slice(0, 120),
    textChars: Math.max(0, Number(meta?.textChars) || 0),
  };
}

let indexMigrateAttempted = false;

/** Drop legacy unique userId index so multiple digests per user are allowed. */
async function ensureMultiResumeIndexes() {
  if (indexMigrateAttempted) return;
  indexMigrateAttempted = true;
  try {
    const indexes = await UserPrepResumeDigest.collection.indexes();
    for (const ix of indexes || []) {
      const keys = ix?.key && typeof ix.key === "object" ? Object.keys(ix.key) : [];
      if (ix.unique && keys.length === 1 && ix.key.userId === 1 && ix.name) {
        await UserPrepResumeDigest.collection.dropIndex(ix.name);
        console.info("[prepPath] dropped legacy unique userId index on resume digests");
      }
    }
  } catch (err) {
    console.warn("[prepPath] resume digest index migrate:", err?.message || err);
  }
  try {
    await UserPrepResumeDigest.collection.createIndex({ userId: 1, updatedAt: -1 });
  } catch {
    /* already exists */
  }
}

export function serializeUserPrepResumeDigest(row) {
  if (!row) {
    return {
      id: "",
      hasDigest: false,
      digest: "",
      fields: digestToFields(""),
      resumeMeta: null,
      updatedAt: null,
      createdAt: null,
    };
  }
  const digest = String(row.digest || "");
  return {
    id: String(row._id || row.id || ""),
    hasDigest: Boolean(digest.trim()),
    digest,
    fields: digestToFields(digest),
    resumeMeta: {
      fileName: String(row.resumeMeta?.fileName || ""),
      mime: String(row.resumeMeta?.mime || ""),
      textChars: Math.max(0, Number(row.resumeMeta?.textChars) || 0),
    },
    updatedAt: row.updatedAt || null,
    createdAt: row.createdAt || null,
  };
}

export function serializeUserPrepResumeDigestList(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => serializeUserPrepResumeDigest(row))
    .filter((row) => row.hasDigest);
}

async function hydrateFromLatestPlan(userId) {
  const latest = await PrepPathPlan.findOne({
    userId,
    resumeDigest: { $exists: true, $nin: [null, ""] },
  })
    .sort({ createdAt: -1 })
    .select({ resumeDigest: 1, resumeMeta: 1, createdAt: 1, updatedAt: 1 })
    .lean();
  const digest = String(latest?.resumeDigest || "").trim();
  if (!digest) return null;
  return createUserPrepResumeDigest({
    userId,
    digest,
    resumeMeta: latest?.resumeMeta,
    source: "prep_path",
  });
}

/**
 * List all saved digests for a user (newest first).
 */
export async function listUserPrepResumeDigests(userId, { hydrateFromPlans = false } = {}) {
  await ensureMultiResumeIndexes();
  const uid = String(userId || "").trim();
  if (!uid) return [];
  let rows = await UserPrepResumeDigest.find({ userId: uid })
    .sort({ updatedAt: -1 })
    .lean();
  if ((!rows || !rows.length) && hydrateFromPlans) {
    const created = await hydrateFromLatestPlan(uid);
    if (created) rows = [created];
  }
  return rows || [];
}

/**
 * Latest digest (compat helper).
 */
export async function getUserPrepResumeDigest(userId, { hydrateFromPlans = false } = {}) {
  const rows = await listUserPrepResumeDigests(userId, { hydrateFromPlans });
  return rows[0] || null;
}

export async function getUserPrepResumeDigestById(userId, digestId) {
  await ensureMultiResumeIndexes();
  const uid = String(userId || "").trim();
  const id = String(digestId || "").trim();
  if (!uid || !id) return null;
  return UserPrepResumeDigest.findOne({ _id: id, userId: uid }).lean();
}

/**
 * Append a new digest (or refresh meta if identical digest text already exists).
 * Enforces MAX_USER_PREP_RESUME_DIGESTS by dropping oldest.
 */
export async function createUserPrepResumeDigest({
  userId,
  digest,
  resumeMeta,
  source = "prep_path",
}) {
  await ensureMultiResumeIndexes();
  const uid = String(userId || "").trim();
  const text = String(digest || "").trim().slice(0, 4000);
  if (!uid || !text) return null;

  const same = await UserPrepResumeDigest.findOne({ userId: uid, digest: text }).lean();
  if (same?._id) {
    return UserPrepResumeDigest.findOneAndUpdate(
      { _id: same._id, userId: uid },
      {
        $set: {
          resumeMeta: asMeta(resumeMeta),
          source: source === "prep_path" ? "prep_path" : "prep_path",
        },
      },
      { new: true }
    ).lean();
  }

  const created = await UserPrepResumeDigest.create({
    userId: uid,
    digest: text,
    resumeMeta: asMeta(resumeMeta),
    source: source === "prep_path" ? "prep_path" : "prep_path",
  });

  const extras = await UserPrepResumeDigest.find({ userId: uid })
    .sort({ updatedAt: -1 })
    .skip(MAX_USER_PREP_RESUME_DIGESTS)
    .select({ _id: 1 })
    .lean();
  if (extras?.length) {
    await UserPrepResumeDigest.deleteMany({
      userId: uid,
      _id: { $in: extras.map((row) => row._id) },
    });
  }

  return created.toObject ? created.toObject() : created;
}

/** @deprecated Prefer createUserPrepResumeDigest — kept for older call sites. */
export async function upsertUserPrepResumeDigest(args) {
  return createUserPrepResumeDigest(args);
}

export async function deleteUserPrepResumeDigest(userId, digestId = "") {
  await ensureMultiResumeIndexes();
  const uid = String(userId || "").trim();
  if (!uid) return { deleted: false, deletedCount: 0 };
  const id = String(digestId || "").trim();
  const result = id
    ? await UserPrepResumeDigest.deleteOne({ _id: id, userId: uid })
    : await UserPrepResumeDigest.deleteMany({ userId: uid });
  return {
    deleted: (result?.deletedCount || 0) > 0,
    deletedCount: result?.deletedCount || 0,
  };
}
