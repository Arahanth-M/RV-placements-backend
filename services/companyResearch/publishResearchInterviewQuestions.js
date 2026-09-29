import mongoose from "mongoose";
import CompanyStatic from "../../models/CompanyStatic.js";
import CompanyPlatformContent from "../../models/CompanyPlatformContent.js";
import { withKeyedAsyncMutex } from "../../utils/keyedAsyncMutex.js";
import { invalidateCompanyDetailCache } from "../companyDetailCache.js";
import { normalizeQuestionKey } from "./researchInterviewQuestions.js";
import { normalizeSourceUrl } from "./urlNormalize.js";
import {
  normalizePrepRoleKey,
  prepRoleCatalogMissing,
  prepRoleScopedKey,
} from "../../utils/prepRole.js";
import { resolveOaPrepRole } from "../../utils/oaPrepRoles.js";
import { getResearchJob, markResearchJobPublished } from "./researchJobService.js";

const PUBLISH_MESSAGES = Object.freeze({
  job_not_found: "Research job not found.",
  already_published: "Research job is already published.",
  not_reviewable: "Research job is not ready to publish.",
  invalid_selection: "Selected questions were not valid.",
  company_not_found: "Company not found.",
  publish_failed: "Research could not be published.",
});

const PUBLISH_STATUS = Object.freeze({
  job_not_found: 404,
  already_published: 409,
  not_reviewable: 409,
  invalid_selection: 400,
  company_not_found: 404,
  publish_failed: 500,
});

export class PublishResearchError extends Error {
  /**
   * @param {keyof typeof PUBLISH_MESSAGES} code
   */
  constructor(code) {
    super(PUBLISH_MESSAGES[code] || PUBLISH_MESSAGES.publish_failed);
    this.name = "PublishResearchError";
    this.code = PUBLISH_MESSAGES[code] ? code : "publish_failed";
    this.status = PUBLISH_STATUS[this.code] || 500;
  }
}

function objectIdString(value) {
  const id = String(value || "").trim();
  if (!/^[a-f\d]{24}$/i.test(id) || !mongoose.Types.ObjectId.isValid(id)) return "";
  return id;
}

/**
 * @param {unknown} selectedIndexes
 * @returns {number[]}
 */
export function parseSelectedIndexes(selectedIndexes) {
  if (!Array.isArray(selectedIndexes) || selectedIndexes.length === 0) {
    throw new PublishResearchError("invalid_selection");
  }
  const seen = new Set();
  const indexes = [];
  for (const value of selectedIndexes) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || seen.has(value)) {
      throw new PublishResearchError("invalid_selection");
    }
    seen.add(value);
    indexes.push(value);
  }
  return indexes;
}

function reviewerIdentity(reviewer) {
  const name = String(reviewer?.name || "").trim();
  const email = String(reviewer?.email || "").trim();
  if (!name && !email) return null;
  return { name, email };
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * @param {unknown} source
 * @returns {{ title: string, url: string, snippet: string, score: number | null } | null}
 */
export function toProductionResearchSource(source, prepRoleKey = "") {
  const normalized = normalizeSourceUrl(source?.url);
  if (!normalized) return null;
  const scoreRaw = source?.tavilyScore ?? source?.score;
  const score =
    typeof scoreRaw === "number" && Number.isFinite(scoreRaw) ? scoreRaw : null;
  return {
    prepRoleKey: String(prepRoleKey ?? ""),
    title: compact(source?.title),
    url: normalized,
    snippet: compact(source?.tavilySnippet ?? source?.snippet),
    score,
  };
}

/**
 * @param {unknown[]} sources
 * @param {Set<string>} existingNormalizedUrls
 */
export function collectResearchSourcesToInsert(sources, existingScopedKeys, prepRoleKey = "") {
  const rows = Array.isArray(sources) ? sources : [];
  const seenInJob = new Set();
  const toInsert = [];
  let duplicateSourceCount = 0;
  const roleKey = String(prepRoleKey ?? "");

  for (const source of rows) {
    const record = toProductionResearchSource(source, roleKey);
    if (!record) continue;
    const urlKey = normalizeSourceUrl(record.url);
    if (!urlKey) continue;
    const scoped = prepRoleScopedKey(roleKey, urlKey);
    if (seenInJob.has(scoped)) {
      duplicateSourceCount += 1;
      continue;
    }
    seenInJob.add(scoped);
    if (existingScopedKeys.has(scoped)) {
      duplicateSourceCount += 1;
      continue;
    }
    existingScopedKeys.add(scoped);
    toInsert.push(record);
  }

  return { toInsert, duplicateSourceCount };
}

function codingSolutionsFromCandidate(candidate) {
  const raw = candidate?.solutions;
  if (!raw || typeof raw !== "object") return null;
  const cpp = compact(raw.cpp);
  const java = compact(raw.java);
  const python = compact(raw.python);
  if (!cpp && !java && !python) return null;
  return { cpp, java, python };
}

function toProductionExperience(candidate, reviewer, prepRoleKey = "") {
  const item = {
    prepRoleKey: String(prepRoleKey ?? ""),
    content: String(candidate?.content || "").trim(),
    status: "approved",
    approvedAt: new Date(),
  };
  const reviewedBy = reviewerIdentity(reviewer);
  if (reviewedBy) item.reviewedBy = reviewedBy;
  return item;
}

function oaFormOf(candidate) {
  const form = String(candidate?.form || "").trim().toLowerCase();
  if (form === "coding" || form === "sql" || form === "mcq") return form;
  if (candidate?.kind === "coding") return "coding";
  if (candidate?.kind === "sql") return "sql";
  return "";
}

function toProductionQuestion(candidate, reviewer, prepRoleKey = "") {
  const question = String(candidate?.question || "").trim();
  const form = oaFormOf(candidate);
  let kind = candidate?.kind === "coding" ? "coding" : "non_coding";
  if (form === "coding") kind = "coding";
  else if (form === "sql") kind = "sql";
  const item = {
    prepRoleKey: String(prepRoleKey ?? ""),
    kind,
    question,
    answer: String(candidate?.answer || "").trim(),
    intuition: String(candidate?.intuition || "").trim(),
    status: "approved",
    approvedAt: new Date(),
  };
  if (kind === "coding") {
    const solutions = codingSolutionsFromCandidate(candidate);
    if (solutions) item.solutions = solutions;
  }
  const reviewedBy = reviewerIdentity(reviewer);
  if (reviewedBy) item.reviewedBy = reviewedBy;
  return item;
}

function toProductionMcq(candidate, reviewer, prepRoleKey = "") {
  const question = String(candidate?.question || "").trim();
  const meta =
    candidate?.mcqMetadata && typeof candidate.mcqMetadata === "object"
      ? candidate.mcqMetadata
      : {};
  const options = Array.isArray(meta.options) ? meta.options : [];
  const byId = Object.fromEntries(
    options.map((opt) => [String(opt?.id || "").toUpperCase(), String(opt?.text || "").trim()])
  );
  const item = {
    prepRoleKey: String(prepRoleKey ?? ""),
    question,
    mcqMetadata: meta,
    optionA: byId.A || "",
    optionB: byId.B || "",
    optionC: byId.C || "",
    optionD: byId.D || "",
    answer: String(meta.correctOptionId || candidate?.answer || "").trim(),
    status: "approved",
    approvedAt: new Date(),
  };
  const reviewedBy = reviewerIdentity(reviewer);
  if (reviewedBy) item.reviewedBy = reviewedBy;
  return item;
}

const PUBLISHABLE_FIELDS = Object.freeze({
  interviewQuestions: "interviewQuestions",
  onlineQuestions: "onlineQuestions",
  interviewExperiences: "interviewExperiences",
});

function publishTarget(field) {
  return PUBLISHABLE_FIELDS[field] || "";
}

function assertReviewJob(job) {
  if (!job) throw new PublishResearchError("job_not_found");
  if (job.status === "published") throw new PublishResearchError("already_published");
  if (job.status !== "review") throw new PublishResearchError("not_reviewable");
  if (!publishTarget(job.field)) throw new PublishResearchError("not_reviewable");
  if (!Array.isArray(job.result?.items)) throw new PublishResearchError("invalid_selection");
}

/**
 * Publish selected interview-question candidates from a Redis research job.
 * Reads candidates from Redis. Does not accept question text from the caller.
 * @param {{ jobId?: string, selectedIndexes?: unknown, reviewer?: { name?: string, email?: string } }} input
 */
export async function publishResearchInterviewQuestions(input = {}) {
  const indexes = parseSelectedIndexes(input.selectedIndexes);
  const jobId = String(input.jobId || "").trim();
  const initial = await getResearchJob(jobId);
  assertReviewJob(initial);

  for (const index of indexes) {
    if (index >= initial.result.items.length) {
      throw new PublishResearchError("invalid_selection");
    }
  }

  const companyId = objectIdString(initial.companyId);
  if (!companyId) throw new PublishResearchError("company_not_found");

  return withKeyedAsyncMutex(`platform-content:${companyId}`, async () => {
    const job = await getResearchJob(jobId);
    assertReviewJob(job);
    for (const index of indexes) {
      if (index >= job.result.items.length) {
        throw new PublishResearchError("invalid_selection");
      }
    }

    const company = await CompanyStatic.findById(companyId).select("_id").lean();
    if (!company) throw new PublishResearchError("company_not_found");

    const oaField = job.field === "onlineQuestions";
    const prepRole = oaField
      ? resolveOaPrepRole(job.role)
      : normalizePrepRoleKey(job.role);
    const prepRoleKey = prepRole.key;
    const prepRoleLabel = prepRole.label;
    const target = publishTarget(job.field);
    const experienceField = target === "interviewExperiences";

    const selectFields = experienceField
      ? `${target} prepRoles researchSources`
      : oaField
        ? `${target} mcqQuestions prepRoles researchSources`
        : `${target} prepRoles researchSources`;

    const existing = await CompanyPlatformContent.findOne({ companyId })
      .select(selectFields)
      .lean();

    const existingItems = Array.isArray(existing?.[target]) ? existing[target] : [];
    const existingMcqs = oaField && Array.isArray(existing?.mcqQuestions) ? existing.mcqQuestions : [];
    const seenQuestions = new Set(
      existingItems
        .map((item) =>
          prepRoleScopedKey(
            item?.prepRoleKey,
            normalizeQuestionKey(experienceField ? item?.content : item?.question)
          )
        )
        .filter((key) => Boolean(key.split("\0")[1]))
    );
    for (const item of existingMcqs) {
      const questionKey = normalizeQuestionKey(item?.question);
      if (questionKey) seenQuestions.add(prepRoleScopedKey(item?.prepRoleKey, questionKey));
    }

    const questionsToInsert = [];
    const mcqsToInsert = [];
    let duplicateCount = 0;
    for (const index of indexes) {
      const candidate = job.result.items[index];
      const questionKey = normalizeQuestionKey(
        experienceField ? candidate?.content : candidate?.question
      );
      const scoped = prepRoleScopedKey(prepRoleKey, questionKey);
      if (!questionKey || seenQuestions.has(scoped)) {
        duplicateCount += 1;
        continue;
      }
      seenQuestions.add(scoped);
      if (experienceField) {
        questionsToInsert.push(toProductionExperience(candidate, input.reviewer, prepRoleKey));
        continue;
      }
      if (oaField && oaFormOf(candidate) === "mcq") {
        mcqsToInsert.push(toProductionMcq(candidate, input.reviewer, prepRoleKey));
        continue;
      }
      questionsToInsert.push(toProductionQuestion(candidate, input.reviewer, prepRoleKey));
    }

    const existingSourceKeys = new Set(
      (Array.isArray(existing?.researchSources) ? existing.researchSources : [])
        .map((item) => prepRoleScopedKey(item?.prepRoleKey, normalizeSourceUrl(item?.url)))
        .filter((key) => Boolean(key.split("\0")[1]))
    );
    const sourceInsert = experienceField
      ? collectResearchSourcesToInsert(
          job.result?.sources,
          existingSourceKeys,
          prepRoleKey
        )
      : { toInsert: [] };
    const sourcesToInsert = sourceInsert.toInsert;

    const prepRoleEntry = { key: prepRoleKey, label: prepRoleLabel };
    const insertedCount = questionsToInsert.length + mcqsToInsert.length;
    const addPrepRole =
      prepRoleKey !== "" &&
      prepRoleCatalogMissing(existing?.prepRoles, prepRoleEntry) &&
      (insertedCount > 0 || sourcesToInsert.length > 0);

    if (insertedCount > 0 || sourcesToInsert.length > 0) {
      try {
        const pushUpdate = {};
        if (questionsToInsert.length > 0) {
          pushUpdate[target] = { $each: questionsToInsert };
        }
        if (mcqsToInsert.length > 0) {
          pushUpdate.mcqQuestions = { $each: mcqsToInsert };
        }
        if (sourcesToInsert.length > 0) {
          pushUpdate.researchSources = { $each: sourcesToInsert };
        }
        if (addPrepRole) pushUpdate.prepRoles = prepRoleEntry;
        const setOnInsert = {
          companyId,
          onlineQuestions: [],
          interviewQuestions: [],
          interviewExperiences: [],
          internshipExperiences: [],
          mustDoTopics: [],
          codingQuestions: [],
          mcqQuestions: [],
          researchSources: [],
          prepRoles: [],
          researchLinksSummaries: [],
        };
        delete setOnInsert[target];
        if (sourcesToInsert.length > 0) delete setOnInsert.researchSources;
        if (mcqsToInsert.length > 0) delete setOnInsert.mcqQuestions;
        await CompanyPlatformContent.updateOne(
          { companyId },
          {
            $push: pushUpdate,
            $setOnInsert: setOnInsert,
          },
          { upsert: true }
        );
      } catch (error) {
        console.error("[company-research] publish write failed", {
          jobId,
          code: "publish_failed",
        });
        throw new PublishResearchError("publish_failed");
      }
      try {
        await invalidateCompanyDetailCache(companyId);
      } catch {
        // Cache invalidation is optional and must not undo the write.
      }
    }

    await markResearchJobPublished(jobId, {
      insertedCount,
      duplicateCount,
    });

    return {
      jobId,
      status: "published",
      insertedCount,
      duplicateCount,
    };
  });
}
