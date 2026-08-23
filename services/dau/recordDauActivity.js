import DauDayUser from "../../models/DauDayUser.js";
import { normalizeDauAction, normalizeOpenedCompanyName } from "./dauActions.js";

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** UTC calendar day key YYYY-MM-DD */
export function utcDayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Record that this user was active today.
 * Unique on (dayKey, userId) → same user on two days = two rows = DAU on both days.
 * Never writes to users1. Never rewrites identity fields on existing dau_day_users rows.
 * Optional `extras.action` is $addToSet onto `actions`.
 * Optional `extras.openedCompany` is $addToSet onto `openedCompanies`.
 * Optional `extras.prepPathCompany` is $addToSet onto `prepPathCompanies`.
 * Existing identity fields on dau_day_users rows are never rewritten.
 */
export async function recordDauActivity(userOrId, extras = {}) {
  const userId = String(
    (userOrId && typeof userOrId === "object"
      ? userOrId._id || userOrId.id
      : userOrId) || ""
  ).trim();
  if (!userId) return;

  const fromObj = userOrId && typeof userOrId === "object" ? userOrId : {};
  const email = String(extras.email ?? fromObj.email ?? "")
    .trim()
    .toLowerCase();
  const username = String(extras.username ?? fromObj.username ?? "").trim();
  const role = String(extras.role ?? fromObj.role ?? "").trim();
  const dayKey = utcDayKey(extras.at ? new Date(extras.at) : new Date());
  const now = new Date();
  const action = normalizeDauAction(extras.action);
  const openedCompany = normalizeOpenedCompanyName(extras.openedCompany);
  const prepPathCompany = normalizeOpenedCompanyName(extras.prepPathCompany);
  const resolvedAction =
    action ||
    (openedCompany ? "opened_company" : "") ||
    (prepPathCompany ? "prep_path" : "");

  /** @type {Record<string, unknown>} */
  const update = {
    $setOnInsert: {
      dayKey,
      userId,
      email,
      username,
      role,
      firstSeenAt: now,
    },
    $set: {
      lastSeenAt: now,
    },
  };
  /** @type {Record<string, unknown>} */
  const addToSet = {};
  if (resolvedAction) addToSet.actions = resolvedAction;
  if (openedCompany) addToSet.openedCompanies = openedCompany;
  if (prepPathCompany) addToSet.prepPathCompanies = prepPathCompany;
  if (Object.keys(addToSet).length > 0) {
    update.$addToSet = addToSet;
  }

  await DauDayUser.updateOne({ dayKey, userId }, update, { upsert: true });
}

/** Fire-and-forget; never throws to callers. */
export function recordDauActivitySafe(userOrId, extras = {}) {
  void recordDauActivity(userOrId, extras).catch((err) => {
    console.warn("[dau] record failed", err?.message || err);
  });
}
