/** User-facing copy when the one-interview-per-user cap applies. */
export const INTERVIEW_LIMIT_REACHED_MESSAGE =
  "Due to tokens limit, we have restricted to only one interview per user, soon it will be removed and can take endless interviews";

export const INTERVIEW_LIMIT_REASON = "INTERVIEW_LIMIT_REACHED";

/** Set to "false" to disable the cap without redeploying frontend copy. */
export const isOneInterviewPerUserEnabled = () => {
  const raw = process.env.INTERVIEW_ONE_PER_USER;
  if (raw === undefined || raw === null || String(raw).trim() === "") return true;
  const normalized = String(raw).trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "no";
};
