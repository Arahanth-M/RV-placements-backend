import mongoose from "mongoose";
import CompanyPlatformContent from "../models/CompanyPlatformContent.js";
import {
  EMPTY_PLATFORM_PREP_COVERAGE,
  platformPrepCoverageByRoleFromDoc,
  platformPrepCoverageFromDoc,
} from "../utils/platformPrepCoverage.js";
import { mapResearchSourcesForClient } from "../utils/researchSources.js";

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

function isApprovedStatus(status) {
  return !status || status === "approved";
}

function prepRoleKeysFromQuestions(items) {
  const keys = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!isApprovedStatus(item?.status)) continue;
    if (String(item?.question || "").trim() === "") continue;
    keys.push(String(item?.prepRoleKey ?? "").trim());
  }
  return keys;
}

function mapPrepRolesForClient(prepRoles) {
  return (Array.isArray(prepRoles) ? prepRoles : [])
    .map((row) => ({
      key: String(row?.key ?? "").trim(),
      label: String(row?.label ?? row?.key ?? "").trim() || "General",
    }))
    .filter((row) => row.key);
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
      platformPrepCoverageByRole: [],
      researchSources: [],
      prepRoles: [],
      onlineQuestions_prepRoleKey: [],
      interviewQuestions_prepRoleKey: [],
      platformContentUpdatedAt: null,
    }));
  }

  /** @type {Record<string, unknown>[]} */
  let docs = [];
  try {
    docs = await CompanyPlatformContent.find({ companyId: { $in: oids } })
      .select({
        companyId: 1,
        prepRoles: 1,
        updatedAt: 1,
        createdAt: 1,
        "onlineQuestions.status": 1,
        "onlineQuestions.question": 1,
        "onlineQuestions.prepRoleKey": 1,
        "mcqQuestions.status": 1,
        "mcqQuestions.question": 1,
        "mcqQuestions.prepRoleKey": 1,
        "interviewQuestions.status": 1,
        "interviewQuestions.question": 1,
        "interviewQuestions.prepRoleKey": 1,
        "interviewExperiences.status": 1,
        "interviewExperiences.content": 1,
        "interviewExperiences.prepRoleKey": 1,
        "internshipExperiences.status": 1,
        "internshipExperiences.content": 1,
        "internshipExperiences.prepRoleKey": 1,
        researchSources: 1,
      })
      .lean();
  } catch {
    return rows.map((row) => ({
      ...row,
      platformPrepCoverage: emptyCoverage(),
      platformPrepCoverageByRole: [],
      researchSources: [],
      prepRoles: [],
      onlineQuestions_prepRoleKey: [],
      interviewQuestions_prepRoleKey: [],
      platformContentUpdatedAt: null,
    }));
  }

  const coverageById = new Map();
  const coverageByRoleById = new Map();
  const sourcesById = new Map();
  const prepMetaById = new Map();
  for (const doc of Array.isArray(docs) ? docs : []) {
    const id = String(doc?.companyId || "");
    if (!id) continue;
    coverageById.set(id, platformPrepCoverageFromDoc(doc));
    coverageByRoleById.set(id, platformPrepCoverageByRoleFromDoc(doc));
    sourcesById.set(id, mapResearchSourcesForClient(doc));
    prepMetaById.set(id, {
      prepRoles: mapPrepRolesForClient(doc?.prepRoles),
      onlineQuestions_prepRoleKey: [
        ...prepRoleKeysFromQuestions(doc?.onlineQuestions),
        ...prepRoleKeysFromQuestions(doc?.mcqQuestions),
      ],
      interviewQuestions_prepRoleKey: prepRoleKeysFromQuestions(doc?.interviewQuestions),
      platformContentUpdatedAt: doc?.updatedAt || doc?.createdAt || null,
    });
  }

  return rows.map((row) => {
    const id = String(row?._id || "");
    const meta = prepMetaById.get(id) || {
      prepRoles: [],
      onlineQuestions_prepRoleKey: [],
      interviewQuestions_prepRoleKey: [],
      platformContentUpdatedAt: null,
    };
    return {
      ...row,
      platformPrepCoverage: coverageById.get(id) || emptyCoverage(),
      platformPrepCoverageByRole: coverageByRoleById.get(id) || [],
      researchSources: sourcesById.get(id) || [],
      ...meta,
    };
  });
}
