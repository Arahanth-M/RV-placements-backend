import mongoose from "mongoose";
import CompanyStatic from "../../models/CompanyStatic.js";
import CompanyPlatformContent from "../../models/CompanyPlatformContent.js";
import { withKeyedAsyncMutex } from "../../utils/keyedAsyncMutex.js";
import { invalidateCompanyDetailCache } from "../companyDetailCache.js";
import { upsertResearchLinksSummary } from "../../utils/researchLinksSummaries.js";
import {
  normalizePrepRoleKey,
  prepRoleCatalogMissing,
  prepRoleScopedKey,
} from "../../utils/prepRole.js";
import {
  PublishResearchError,
  collectResearchSourcesToInsert,
} from "./publishResearchInterviewQuestions.js";
import {
  canManageResearchLinks,
  getResearchJob,
  markResearchJobSourcesPublished,
  researchLinksAlreadyPublished,
} from "./researchJobService.js";

function objectIdString(value) {
  const id = String(value || "").trim();
  if (!/^[a-f\d]{24}$/i.test(id) || !mongoose.Types.ObjectId.isValid(id)) return "";
  return id;
}

function assertSourcesPublishable(job) {
  if (!job) throw new PublishResearchError("job_not_found");
  if (researchLinksAlreadyPublished(job)) throw new PublishResearchError("already_published");
  if (!canManageResearchLinks(job)) throw new PublishResearchError("not_reviewable");
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Persist all discovered research sources from the canonical Redis job.
 * @param {{ jobId?: string }} input
 */
export async function publishResearchSources(input = {}) {
  const jobId = String(input.jobId || "").trim();
  const initial = await getResearchJob(jobId);
  assertSourcesPublishable(initial);

  const companyId = objectIdString(initial.companyId);
  if (!companyId) throw new PublishResearchError("company_not_found");

  return withKeyedAsyncMutex(`platform-content:${companyId}`, async () => {
    const job = await getResearchJob(jobId);
    assertSourcesPublishable(job);

    const { key: prepRoleKey, label: prepRoleLabel } = normalizePrepRoleKey(job.role);
    const prepRoleEntry = { key: prepRoleKey, label: prepRoleLabel };

    const company = await CompanyStatic.findById(companyId).select("_id").lean();
    if (!company) throw new PublishResearchError("company_not_found");

    const existing = await CompanyPlatformContent.findOne({ companyId })
      .select("researchSources prepRoles researchLinksSummaries")
      .lean();

    const { normalizeSourceUrl } = await import("./urlNormalize.js");
    const existingScopedKeys = new Set(
      (Array.isArray(existing?.researchSources) ? existing.researchSources : [])
        .map((item) =>
          prepRoleScopedKey(item?.prepRoleKey, normalizeSourceUrl(item?.url))
        )
        .filter((key) => Boolean(key.split("\0")[1]))
    );
    const jobSources = Array.isArray(job.result?.sources) ? job.result.sources : [];
    const { toInsert: sourcesToInsert, duplicateSourceCount } = collectResearchSourcesToInsert(
      jobSources,
      existingScopedKeys,
      prepRoleKey
    );

    const draftSummary = compact(job.linksSummaryDraft?.summary);
    const summaryRoleKey = String(job.linksSummaryDraft?.prepRoleKey ?? prepRoleKey);
    const nextSummaries =
      draftSummary && summaryRoleKey === prepRoleKey
        ? upsertResearchLinksSummary(existing?.researchLinksSummaries, {
            prepRoleKey,
            summary: draftSummary,
          })
        : null;

    const addPrepRole =
      prepRoleKey !== "" &&
      prepRoleCatalogMissing(existing?.prepRoles, prepRoleEntry) &&
      (sourcesToInsert.length > 0 || Boolean(draftSummary));
    const shouldWrite = sourcesToInsert.length > 0 || nextSummaries != null || addPrepRole;

    if (shouldWrite) {
      try {
        const update = { $setOnInsert: {
            companyId,
            onlineQuestions: [],
            interviewQuestions: [],
            interviewExperiences: [],
            internshipExperiences: [],
            mustDoTopics: [],
            codingQuestions: [],
            mcqQuestions: [],
          } };
        const pushUpdate = {};
        if (sourcesToInsert.length > 0) {
          pushUpdate.researchSources = { $each: sourcesToInsert };
        }
        if (addPrepRole) {
          pushUpdate.prepRoles = prepRoleEntry;
        }
        const mongoUpdate = { ...update };
        if (Object.keys(pushUpdate).length > 0) {
          mongoUpdate.$push = pushUpdate;
        }
        if (nextSummaries != null) {
          mongoUpdate.$set = { researchLinksSummaries: nextSummaries };
        }
        await CompanyPlatformContent.updateOne({ companyId }, mongoUpdate, { upsert: true });
      } catch (error) {
        console.error("[company-research] source publish write failed", {
          jobId,
          message: error?.message,
          code: error?.code,
        });
        throw new PublishResearchError("publish_failed");
      }
      try {
        await invalidateCompanyDetailCache(companyId);
      } catch {
        // optional
      }
    }

    await markResearchJobSourcesPublished(jobId, {
      insertedSourceCount: sourcesToInsert.length,
      duplicateSourceCount,
    });

    return {
      jobId,
      status: job.status === "published" ? "published" : "review",
      prepRoleKey,
      insertedSourceCount: sourcesToInsert.length,
      duplicateSourceCount,
      summaryPersisted: Boolean(nextSummaries != null && draftSummary),
    };
  });
}
