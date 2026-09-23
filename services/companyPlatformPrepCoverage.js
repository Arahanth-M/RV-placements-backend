import mongoose from "mongoose";
import CompanyPlatformContent from "../models/CompanyPlatformContent.js";
import {
  EMPTY_PLATFORM_PREP_COVERAGE,
  platformPrepCoverageFromDoc,
} from "../utils/platformPrepCoverage.js";

function asObjectId(value) {
  try {
    return new mongoose.Types.ObjectId(String(value || ""));
  } catch {
    return null;
  }
}

function emptyCoverage() {
  return { ...EMPTY_PLATFORM_PREP_COVERAGE };
}

/**
 * Overlay OA / interview / experience counts onto GET /api/companies rows.
 * Read-only; does not write platform content. Fail-open to zeros.
 * @param {Record<string, unknown>[]} list
 */
export async function attachPlatformPrepCoverageToCompanyList(list) {
  const rows = Array.isArray(list) ? list : [];
  if (!rows.length) return rows;

  const oids = [
    ...new Set(rows.map((row) => String(row?._id || "")).filter(Boolean)),
  ]
    .map(asObjectId)
    .filter(Boolean);

  if (!oids.length) {
    return rows.map((row) => ({
      ...row,
      platformPrepCoverage: emptyCoverage(),
    }));
  }

  /** @type {Record<string, unknown>[]} */
  let docs = [];
  try {
    docs = await CompanyPlatformContent.find({ companyId: { $in: oids } })
      .select({
        companyId: 1,
        "onlineQuestions.status": 1,
        "onlineQuestions.question": 1,
        "interviewQuestions.status": 1,
        "interviewQuestions.question": 1,
        "interviewExperiences.status": 1,
        "interviewExperiences.content": 1,
        "internshipExperiences.status": 1,
        "internshipExperiences.content": 1,
      })
      .lean();
  } catch {
    return rows.map((row) => ({
      ...row,
      platformPrepCoverage: emptyCoverage(),
    }));
  }

  const byId = new Map();
  for (const doc of Array.isArray(docs) ? docs : []) {
    const id = String(doc?.companyId || "");
    if (!id) continue;
    byId.set(id, platformPrepCoverageFromDoc(doc));
  }

  return rows.map((row) => ({
    ...row,
    platformPrepCoverage: byId.get(String(row?._id || "")) || emptyCoverage(),
  }));
}
