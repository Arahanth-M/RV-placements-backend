import { laterDateIso } from "../utils/laterDate.js";

/**
 * Timestamps that mean this visit’s placement content changed.
 * Omits `updatedAt` — profile views `$inc` that field.
 */
export function visitContentTimestampIso(visit) {
  if (!visit || typeof visit !== "object") return null;
  const recruitment = visit.recruitment_process;
  const recruitmentAt =
    recruitment && typeof recruitment === "object" && !Array.isArray(recruitment)
      ? recruitment.submittedAt
      : null;
  return laterDateIso(
    visit.migratedAt,
    visit.approvedAt,
    visit.createdAt,
    recruitmentAt
  );
}

/**
 * Latest content-touch time for a company card.
 * `staticUpdatedAt` covers About, Coding (`prev_coding_ques`), and helpful votes.
 */
export function companyCardContentUpdatedAtIso({
  staticUpdatedAt = null,
  visits = [],
  extras = [],
} = {}) {
  const visitDates = (Array.isArray(visits) ? visits : []).map(visitContentTimestampIso);
  return laterDateIso(
    staticUpdatedAt,
    ...visitDates,
    ...(Array.isArray(extras) ? extras : [])
  );
}
