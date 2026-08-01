import PrepPathUsage from "../../models/PrepPathUsage.js";
import { istDateParts } from "../../utils/istSlotTime.js";

/**
 * Daily generate cap. `null` / `0` / negative = unlimited (current: unlimited).
 * Restore a positive number (e.g. 2) to re-enable the limit later.
 */
export const PREP_PATH_DAILY_LIMIT = null;

const pad2 = (n) => String(n).padStart(2, "0");

const isUnlimited = () =>
  PREP_PATH_DAILY_LIMIT == null ||
  !Number.isFinite(Number(PREP_PATH_DAILY_LIMIT)) ||
  Number(PREP_PATH_DAILY_LIMIT) <= 0;

/** IST calendar day key `YYYY-MM-DD`. */
export function istDayKey(date = new Date()) {
  const p = istDateParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function quotaPayload({ dayKey, used }) {
  if (isUnlimited()) {
    return {
      dayKey,
      unlimited: true,
      limit: null,
      used: Math.max(0, Number(used) || 0),
      remaining: null,
    };
  }
  const limit = Number(PREP_PATH_DAILY_LIMIT);
  const usedN = Math.max(0, Number(used) || 0);
  return {
    dayKey,
    unlimited: false,
    limit,
    used: usedN,
    remaining: Math.max(0, limit - usedN),
  };
}

export async function getPrepPathQuota(userId) {
  const uid = String(userId || "").trim();
  const dayKey = istDayKey();
  if (!uid) {
    return quotaPayload({ dayKey, used: 0 });
  }
  const row = await PrepPathUsage.findOne({ userId: uid, dayKey }).lean();
  return quotaPayload({ dayKey, used: Number(row?.count) || 0 });
}

/**
 * Record one generate for today (IST). Only touches `prep_path_usage`.
 * When unlimited, never rejects.
 */
export async function consumePrepPathQuota(userId) {
  const uid = String(userId || "").trim();
  if (!uid) {
    const err = new Error("Unauthorized");
    err.code = "UNAUTHORIZED";
    throw err;
  }
  const dayKey = istDayKey();

  if (isUnlimited()) {
    const updated = await PrepPathUsage.findOneAndUpdate(
      { userId: uid, dayKey },
      { $inc: { count: 1 } },
      { new: true, upsert: true }
    ).lean();
    return quotaPayload({ dayKey, used: Number(updated?.count) || 1 });
  }

  const limit = Number(PREP_PATH_DAILY_LIMIT);

  const updated = await PrepPathUsage.findOneAndUpdate(
    { userId: uid, dayKey, count: { $lt: limit } },
    { $inc: { count: 1 } },
    { new: true, upsert: false }
  ).lean();

  if (updated) {
    return quotaPayload({ dayKey, used: Number(updated.count) || 0 });
  }

  try {
    const created = await PrepPathUsage.create({ userId: uid, dayKey, count: 1 });
    return quotaPayload({ dayKey, used: Number(created.count) || 1 });
  } catch (err) {
    if (err?.code === 11000) {
      const again = await PrepPathUsage.findOneAndUpdate(
        { userId: uid, dayKey, count: { $lt: limit } },
        { $inc: { count: 1 } },
        { new: true }
      ).lean();
      if (again) {
        return quotaPayload({ dayKey, used: Number(again.count) || 0 });
      }
    } else {
      throw err;
    }
  }

  const exhausted = new Error(
    `Daily PrepPath limit reached (${limit} plans per day). Try again tomorrow (IST).`
  );
  exhausted.code = "QUOTA_EXCEEDED";
  throw exhausted;
}

/** Best-effort refund one slot on prep_path_usage only (e.g. LLM failure after consume). */
export async function refundPrepPathQuota(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return;
  const dayKey = istDayKey();
  await PrepPathUsage.findOneAndUpdate(
    { userId: uid, dayKey, count: { $gt: 0 } },
    { $inc: { count: -1 } }
  );
}
