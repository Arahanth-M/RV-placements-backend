/** User-facing reason code when the weekly interview cap applies. */
export const INTERVIEW_LIMIT_REASON = "INTERVIEW_LIMIT_REACHED";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_ELEVATED_WEEKLY_MAX = 3;

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

function parseCsvEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return [];
  return String(raw)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Comma-separated allowlists (env):
 * - INTERVIEW_WEEKLY_LIMIT_ELEVATED_USER_IDS — auth userId values
 * - INTERVIEW_WEEKLY_LIMIT_ELEVATED_EMAILS — login emails (case-insensitive)
 * Elevated users may take INTERVIEW_WEEKLY_LIMIT_ELEVATED_MAX interviews per rolling window (default 3).
 */
export function getInterviewWeeklyLimitElevatedUsers() {
  const ids = new Set(parseCsvEnv("INTERVIEW_WEEKLY_LIMIT_ELEVATED_USER_IDS"));
  const emails = new Set(
    parseCsvEnv("INTERVIEW_WEEKLY_LIMIT_ELEVATED_EMAILS").map((email) =>
      email.toLowerCase()
    )
  );
  return { ids, emails };
}

export function isInterviewWeeklyLimitElevatedUser({ userId, email } = {}) {
  const { ids, emails } = getInterviewWeeklyLimitElevatedUsers();
  const id = String(userId || "").trim();
  if (id && ids.has(id)) return true;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return Boolean(normalizedEmail && emails.has(normalizedEmail));
}

export function getInterviewWeeklyLimitMaxForUser({ userId, email } = {}) {
  if (!isInterviewWeeklyLimitElevatedUser({ userId, email })) return 1;
  const raw = process.env.INTERVIEW_WEEKLY_LIMIT_ELEVATED_MAX;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return DEFAULT_ELEVATED_WEEKLY_MAX;
}

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

/**
 * Rolling-window cap: allow up to `maxPerWindow` completed interviews in the last `windowMs`.
 * @param {{ completedAtTimestamps?: Array<Date|string>, now?: Date, windowMs?: number, maxPerWindow?: number }} params
 */
export const computeRollingWindowInterviewEligibility = ({
  completedAtTimestamps = [],
  now = new Date(),
  windowMs = getInterviewWeeklyLimitMs(),
  maxPerWindow = 1,
} = {}) => {
  const max = Math.max(1, Number(maxPerWindow) || 1);
  const windowStartMs = now.getTime() - windowMs;
  const inWindow = (Array.isArray(completedAtTimestamps) ? completedAtTimestamps : [])
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()) && date.getTime() > windowStartMs)
    .sort((a, b) => a.getTime() - b.getTime());

  const lastCompletedAt =
    inWindow.length > 0 ? inWindow[inWindow.length - 1] : null;

  if (inWindow.length < max) {
    return {
      canStart: true,
      nextAvailableAt: null,
      lastCompletedAt,
      completionsInWindow: inWindow.length,
      weeklyLimitMax: max,
    };
  }

  const oldest = inWindow[0];
  const nextAvailableAt = new Date(oldest.getTime() + windowMs);
  return {
    canStart: now >= nextAvailableAt,
    nextAvailableAt: now >= nextAvailableAt ? null : nextAvailableAt,
    lastCompletedAt,
    completionsInWindow: inWindow.length,
    weeklyLimitMax: max,
  };
};

export const buildInterviewLimitReachedMessage = (nextAvailableAt, weeklyMax = 1) => {
  const days = getInterviewWeeklyLimitDays();
  const dayLabel = days === 1 ? "day" : "days";
  const max = Math.max(1, Number(weeklyMax) || 1);
  const limitPhrase =
    max === 1
      ? `one AI mock interview every ${days} ${dayLabel}`
      : `up to ${max} AI mock interviews every ${days} ${dayLabel}`;

  if (!nextAvailableAt) {
    return `You can take ${limitPhrase}. Please try again later.`;
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
    return `You can take ${limitPhrase}. Your next interview will be available on ${formatted} (IST).`;
  } catch {
    return `You can take ${limitPhrase}. Please try again later.`;
  }
};

/** @deprecated Use buildInterviewLimitReachedMessage */
export const INTERVIEW_LIMIT_REACHED_MESSAGE = buildInterviewLimitReachedMessage();
