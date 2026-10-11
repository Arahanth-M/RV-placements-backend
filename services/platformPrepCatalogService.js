import CompanyStatic from "../models/CompanyStatic.js";
import CompanyPlatformContent from "../models/CompanyPlatformContent.js";
import { companyHasResearchPipelineContent } from "../utils/researchPipelineAdded.js";
import { attachPlatformPrepCoverageToCompanyList } from "./companyPlatformPrepCoverage.js";

async function researchPipelineAddedByCompanyId(rows) {
  const ids = rows.map((row) => row._id).filter(Boolean);
  if (!ids.length) return new Map();
  const docs = await CompanyPlatformContent.find({ companyId: { $in: ids } })
    .select({
      companyId: 1,
      "onlineQuestions.status": 1,
      "onlineQuestions.question": 1,
      "onlineQuestions.submittedBy": 1,
      "onlineQuestions.reviewedBy": 1,
      "interviewQuestions.status": 1,
      "interviewQuestions.question": 1,
      "interviewQuestions.submittedBy": 1,
      "interviewQuestions.reviewedBy": 1,
      "mcqQuestions.status": 1,
      "mcqQuestions.question": 1,
      "mcqQuestions.submittedBy": 1,
      "mcqQuestions.reviewedBy": 1,
      "interviewExperiences.status": 1,
      "interviewExperiences.content": 1,
      "interviewExperiences.submittedBy": 1,
      "interviewExperiences.reviewedBy": 1,
      "internshipExperiences.status": 1,
      "internshipExperiences.content": 1,
      "internshipExperiences.submittedBy": 1,
      "internshipExperiences.reviewedBy": 1,
      researchSources: 1,
      researchLinksSummaries: 1,
    })
    .lean();
  const added = new Map();
  for (const doc of Array.isArray(docs) ? docs : []) {
    const id = String(doc?.companyId || "");
    if (!id) continue;
    added.set(id, companyHasResearchPipelineContent(doc));
  }
  return added;
}

/**
 * Every CompanyStatic row for the platform admin prep editor, with the
 * business model Student Corner uses for categories and lean coverage counts.
 * @returns {Promise<Array<{ _id: unknown, name: string, business_model: string, logo: unknown, platformPrepCoverage: { oa: number, interview: number, experiences: number } }>>}
 */
export async function listPlatformPrepCatalog() {
  const rows = await CompanyStatic.find({})
    .select({ _id: 1, name: 1, business_model: 1, logo: 1 })
    .sort({ name: 1 })
    .lean();

  const listed = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      _id: row._id,
      name: String(row?.name || "").trim(),
      business_model: String(row?.business_model || "").trim(),
      logo: row?.logo || "",
    }))
    .filter((row) => row._id && row.name);

  const withCoverage = await attachPlatformPrepCoverageToCompanyList(listed);
  const pipelineAdded = await researchPipelineAddedByCompanyId(listed);
  return withCoverage.map((row) => ({
    _id: row._id,
    name: row.name,
    business_model: row.business_model || "",
    logo: row.logo || "",
    platformPrepCoverage: row.platformPrepCoverage,
    researchPipelineAdded: pipelineAdded.get(String(row._id)) === true,
  }));
}
