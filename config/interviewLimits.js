/** User-facing reason code when the weekly interview cap applies. */
export const INTERVIEW_LIMIT_REASON = "INTERVIEW_LIMIT_REACHED";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const getInterviewWeeklyLimitDays = () => {
  const raw = process.env.INTERVIEW_WEEKLY_LIMIT_DAYS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 7;
};

export const getInterviewWeeklyLimitMs = () => getInterviewWeeklyLimitDays() * MS_PER_DAY;

/** Set to "false" to disable the weekly cap without redeploying frontend copy. */
export const isInterviewWeeklyLimitEnabled = () => {
  const raw = process.env.INTERVIEW_ONE_PER_USER ?? process.env.INTERVIEW_WEEKLY_LIMIT_ENABLED;
  if (raw === undefined || raw === null || String(raw).trim() === "") return true;
  const normalized = String(raw).trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "no";
};

/** @deprecated Use isInterviewWeeklyLimitEnabled */
export const isOneInterviewPerUserEnabled = isInterviewWeeklyLimitEnabled;

/**
 * Pure helper for weekly cooldown checks (used by eligibility service + tests).
 * @param {{ lastCompletedAt?: Date|string|null, now?: Date, cooldownMs?: number }} params
 */
export const computeWeeklyInterviewEligibility = ({
  lastCompletedAt = null,
  now = new Date(),
  cooldownMs = getInterviewWeeklyLimitMs(),
} = {}) => {
  if (!lastCompletedAt) {
    return { canStart: true, nextAvailableAt: null, lastCompletedAt: null };
  }

  const completedAt = new Date(lastCompletedAt);
  if (Number.isNaN(completedAt.getTime())) {
    return { canStart: true, nextAvailableAt: null, lastCompletedAt: null };
  }

  const nextAvailableAt = new Date(completedAt.getTime() + cooldownMs);
  if (now < nextAvailableAt) {
    return {
      canStart: false,
      nextAvailableAt,
      lastCompletedAt: completedAt,
    };
  }

  return { canStart: true, nextAvailableAt: null, lastCompletedAt: completedAt };
};

export const buildInterviewLimitReachedMessage = (nextAvailableAt) => {
  const days = getInterviewWeeklyLimitDays();
  const dayLabel = days === 1 ? "day" : "days";

  if (!nextAvailableAt) {
    return `You can take one AI mock interview every ${days} ${dayLabel}. Please try again later.`;
  }

  try {
    const date = new Date(nextAvailableAt);
    const formatted = date.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });
    return `You can take one AI mock interview every ${days} ${dayLabel}. Your next interview will be available on ${formatted} (IST).`;
  } catch {
    return `You can take one AI mock interview every ${days} ${dayLabel}. Please try again later.`;
  }
};

/** @deprecated Use buildInterviewLimitReachedMessage */
export const INTERVIEW_LIMIT_REACHED_MESSAGE = buildInterviewLimitReachedMessage();
