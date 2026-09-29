import mongoose from "mongoose";
import CompanyStatic from "../models/CompanyStatic.js";
import CompanyPlatformContent from "../models/CompanyPlatformContent.js";
import { getCompanyFocusTags } from "../utils/companyFocusTags.js";
import { normalizeSolutionText } from "../utils/normalizeSolutionText.js";
import { prepareSourceCodeForDisplay } from "../utils/prepareSourceCodeForDisplay.js";
import { mapResearchSourcesForClient } from "../utils/researchSources.js";
import { mapResearchLinksSummariesForClient } from "../utils/researchLinksSummaries.js";
import { platformPrepCoverageFromDoc } from "../utils/platformPrepCoverage.js";

function approvedItems(arr) {
  return (Array.isArray(arr) ? arr : []).filter(
    (item) => !item?.status || item.status === "approved"
  );
}

function text(value) {
  return String(value || "").trim();
}

function mapQuestionArrays(items) {
  const questions = [];
  const solutionsLegacy = [];
  const solutionsByLang = [];
  const intuitions = [];
  const prepRoleKeys = [];
  const kinds = [];

  for (const item of approvedItems(items)) {
    const question = text(item?.question);
    if (!question) continue;
    const sols = item?.solutions && typeof item.solutions === "object" ? item.solutions : {};
    const cpp = prepareSourceCodeForDisplay(normalizeSolutionText(sols.cpp), "cpp");
    const java = prepareSourceCodeForDisplay(normalizeSolutionText(sols.java), "java");
    const python = prepareSourceCodeForDisplay(normalizeSolutionText(sols.python), "python");
    const answer = normalizeSolutionText(item?.answer);
    questions.push(question);
    solutionsLegacy.push(cpp || java || python || answer);
    solutionsByLang.push({ cpp, java, python });
    intuitions.push(text(item?.intuition));
    prepRoleKeys.push(text(item?.prepRoleKey));
    kinds.push(text(item?.kind) || "non_coding");
  }

  return { questions, solutionsLegacy, solutionsByLang, intuitions, prepRoleKeys, kinds };
}

function mapMcqQuestionsForClient(items) {
  return approvedItems(items)
    .map((item) => {
      const question = text(item?.question);
      if (!question) return null;
      const meta =
        item?.mcqMetadata && typeof item.mcqMetadata === "object" ? item.mcqMetadata : null;
      const options = meta && Array.isArray(meta.options) ? meta.options : [];
      const byId = Object.fromEntries(
        options.map((opt) => [String(opt?.id || "").toUpperCase(), text(opt?.text)])
      );
      return {
        question,
        prepRoleKey: text(item?.prepRoleKey),
        mcqMetadata: meta,
        optionA: text(item?.optionA) || byId.A || "",
        optionB: text(item?.optionB) || byId.B || "",
        optionC: text(item?.optionC) || byId.C || "",
        optionD: text(item?.optionD) || byId.D || "",
        answer: text(meta?.correctOptionId || item?.answer),
        explanation: text(meta?.explanation || item?.intuition),
      };
    })
    .filter(Boolean);
}

function mapExperiences(items) {
  return approvedItems(items)
    .map((item) => {
      const content = text(item?.content);
      if (!content) return null;
      return {
        content,
        prepRoleKey: text(item?.prepRoleKey),
        isAnonymous: item?.isAnonymous === true,
        submittedBy: item?.submittedBy,
        approvedAt: item?.approvedAt,
        createdAt: item?.createdAt,
      };
    })
    .filter(Boolean);
}

function mapCodingQuestions(items) {
  const out = [];
  for (const item of approvedItems(items)) {
    const raw = item?.question;
    const base =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? { ...raw }
        : raw
          ? { Title: text(raw) }
          : null;
    if (!base) continue;
    const intuition = text(item?.intuition || base.intuition);
    if (intuition) base.intuition = intuition;
    const sols = item?.solutions && typeof item.solutions === "object" ? item.solutions : {};
    const cpp = prepareSourceCodeForDisplay(normalizeSolutionText(sols.cpp), "cpp");
    const java = prepareSourceCodeForDisplay(normalizeSolutionText(sols.java), "java");
    const python = prepareSourceCodeForDisplay(normalizeSolutionText(sols.python), "python");
    if (cpp) base.solution_cpp = cpp;
    if (java) base.solution_java = java;
    if (python) base.solution_python = python;
    out.push(base);
  }
  return out;
}

/**
 * Company detail for `/general`: static identity + merged platform prep.
 * Does not read or write company visits.
 * @param {string} companyId
 * @returns {Promise<object|null>}
 */
export async function getCompanyPlatformDetailById(companyId) {
  let oid;
  try {
    oid = new mongoose.Types.ObjectId(String(companyId));
  } catch {
    return null;
  }

  const [staticRow, platform] = await Promise.all([
    CompanyStatic.findById(oid).lean(),
    CompanyPlatformContent.findOne({ companyId: oid }).lean(),
  ]);

  if (!staticRow) return null;

  const oa = mapQuestionArrays(platform?.onlineQuestions);
  const iq = mapQuestionArrays(platform?.interviewQuestions);
  const mustDo = approvedItems(platform?.mustDoTopics)
    .map((item) => text(item?.topic))
    .filter(Boolean);
  const mustDoMerged = [...new Set([...mustDo, ...(Array.isArray(staticRow.must_do_topics) ? staticRow.must_do_topics.map(text).filter(Boolean) : [])])];

  const interviewProcess = mapExperiences(platform?.interviewExperiences);
  const internshipExperience = mapExperiences(platform?.internshipExperiences);
  const prev_coding_ques = mapCodingQuestions(platform?.codingQuestions);

  const payload = {
    _id: staticRow._id,
    name: staticRow.name,
    logo: staticRow.logo,
    about: staticRow.about,
    "About The Company": staticRow.about,
    business_model: staticRow.business_model,
    helpfulCount: staticRow.helpfulCount || 0,
    contentSource: "platform",
    onlineQuestions: oa.questions,
    onlineQuestions_solution: oa.solutionsLegacy,
    onlineQuestions_solutions: oa.solutionsByLang,
    onlineQuestions_intuition: oa.intuitions,
    interviewQuestions: iq.questions,
    interviewQuestions_solution: iq.solutionsLegacy,
    interviewQuestions_solutions: iq.solutionsByLang,
    interviewQuestions_intuition: iq.intuitions,
    interviewQuestions_prepRoleKey: iq.prepRoleKeys,
    onlineQuestions_prepRoleKey: oa.prepRoleKeys,
    onlineQuestions_kind: oa.kinds,
    prepRoles: Array.isArray(platform?.prepRoles)
      ? platform.prepRoles.map((row) => ({
          key: text(row?.key),
          label: text(row?.label) || text(row?.key) || "General",
        }))
      : [],
    researchLinksSummaries: mapResearchLinksSummariesForClient(platform),
    interviewProcess,
    internshipExperience,
    must_do_topics: mustDoMerged,
    Must_Do_Topics: mustDoMerged,
    prev_coding_ques,
    mcqQuestions: mapMcqQuestionsForClient(platform?.mcqQuestions),
    researchSources: mapResearchSourcesForClient(platform),
    platformPrepCoverage: platformPrepCoverageFromDoc(platform),
    platformContentUpdatedAt: platform?.updatedAt || platform?.createdAt || null,
    placementYearsAvailable: [],
    roles: [],
    date_of_visit: "",
    type: "",
    eligibility: "",
  };

  payload.focusTags = getCompanyFocusTags(payload);
  return payload;
}

export function isPlatformCompanyScope(query) {
  return String(query?.scope || "").trim().toLowerCase() === "platform";
}
