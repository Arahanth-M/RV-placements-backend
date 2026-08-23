/**
 * Response-only date sidecar for experience cards. Does not write visit or submission docs.
 */
import Submission from "../models/Submission.js";
import { attachExperienceEntryDates } from "./experienceEntryDates.js";

/**
 * @param {Record<string, unknown>|null|undefined} companyObj
 * @param {unknown} companyId
 */
export async function attachExperienceEntryDatesFromDb(companyObj, companyId) {
  if (!companyObj || typeof companyObj !== "object" || companyId == null) {
    return companyObj;
  }

  const processEntries = companyObj.interviewProcess;
  const internEntries = companyObj.internshipExperience;
  const hasProcess = Array.isArray(processEntries)
    ? processEntries.length > 0
    : Boolean(processEntries && String(processEntries).trim());
  const hasIntern = Array.isArray(internEntries)
    ? internEntries.length > 0
    : Boolean(internEntries && String(internEntries).trim());

  if (!hasProcess && !hasIntern) {
    return {
      ...companyObj,
      interviewProcessUpdatedAt: [],
      internshipExperienceUpdatedAt: [],
    };
  }

  const rows = await Submission.find({
    companyId,
    status: "approved",
    type: { $in: ["interviewProcess", "internshipExperience"] },
  })
    .select("type content approvedAt submittedAt")
    .lean();

  return attachExperienceEntryDates(companyObj, {
    interviewProcess: rows.filter((row) => row.type === "interviewProcess"),
    internshipExperience: rows.filter((row) => row.type === "internshipExperience"),
  });
}
