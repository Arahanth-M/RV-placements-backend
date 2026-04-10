import { redisUrl } from "../src/utils/redisClient.js";
import { getJSON, setJSON, deleteKey } from "../src/utils/redisHelpers.js";

const KEY_PREFIX = "rv:student:profile:";
const TTL_SECONDS = 300;

function normalizeEmail(email) {
  if (email == null || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

function redisKeyForEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  return `${KEY_PREFIX}${e}`;
}

export async function getCachedStudentProfile(email) {
  if (!redisUrl) return null;
  const key = redisKeyForEmail(email);
  if (!key) return null;
  return getJSON(key);
}

export async function setCachedStudentProfile(email, payload) {
  if (!redisUrl) return;
  const key = redisKeyForEmail(email);
  if (!key) return;
  await setJSON(key, payload, TTL_SECONDS);
}

export async function invalidateStudentProfileCacheByEmail(email) {
  if (!redisUrl) {
    return { deleted: 0, skippedNoRedis: true };
  }
  const key = redisKeyForEmail(email);
  if (!key) return { deleted: 0 };
  const ok = await deleteKey(key);
  return { deleted: ok ? 1 : 0 };
}

export async function invalidateStudentProfileCacheByEmails(emails) {
  const normalized = [
    ...new Set(
      (emails || [])
        .filter((e) => typeof e === "string")
        .map((e) => normalizeEmail(e))
        .filter(Boolean)
    ),
  ];

  if (!redisUrl) {
    return {
      requested: normalized.length,
      deleted: 0,
      skippedNoRedis: true,
      emails: normalized,
    };
  }

  let deleted = 0;
  for (const email of normalized) {
    const key = redisKeyForEmail(email);
    if (key && (await deleteKey(key))) deleted += 1;
  }

  return {
    requested: normalized.length,
    deleted,
    emails: normalized,
  };
}
