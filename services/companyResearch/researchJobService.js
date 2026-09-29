import { randomUUID } from "node:crypto";
import { getJSON, setJSON } from "../../src/utils/redisHelpers.js";

/** Abandoned research jobs expire on their own. */
export const RESEARCH_JOB_TTL_SECONDS = 24 * 60 * 60;

export const RESEARCH_JOB_KEY_PREFIX = "company-research:job:";

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAFE_ERROR_MESSAGES = Object.freeze({
  invalid_input: "Research input was not valid.",
  search_failed: "Research could not be completed.",
  research_failed: "Research could not be completed.",
});

export function researchJobKey(jobId) {
  return `${RESEARCH_JOB_KEY_PREFIX}${jobId}`;
}

export function safeResearchError(error) {
  const code = Object.prototype.hasOwnProperty.call(SAFE_ERROR_MESSAGES, error?.code)
    ? error.code
    : "research_failed";
  return { code, message: SAFE_ERROR_MESSAGES[code] };
}

function withoutPageContent(value) {
  if (Array.isArray(value)) return value.map(withoutPageContent);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "markdown" || key === "html" || key === "stack" || key === "headers") continue;
    out[key] = withoutPageContent(item);
  }
  return out;
}

async function writeJob(record) {
  const ok = await setJSON(researchJobKey(record.jobId), record, RESEARCH_JOB_TTL_SECONDS);
  if (!ok) {
    const error = new Error("Research job could not be stored.");
    error.code = "job_store_failed";
    throw error;
  }
}

/**
 * @param {string} jobId
 */
export async function getResearchJob(jobId) {
  if (!JOB_ID_RE.test(String(jobId || ""))) return null;
  const record = await getJSON(researchJobKey(jobId));
  if (!record || record.jobId !== jobId) return null;
  return record;
}

/**
 * Queue a research job. Does not run Tavily, Firecrawl, or Groq.
 * @param {{ companyId: string, companyName: string, role?: string, country?: string, maxSources?: number, searchDepth?: string }} input
 */
export async function startResearchJob(input) {
  const jobId = randomUUID();
  const record = {
    jobId,
    status: "queued",
    companyId: input.companyId,
    companyName: input.companyName,
    field: input.field || "interviewQuestions",
    role: input.role || "",
    country: input.country || "",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
  };
  await writeJob(record);

  try {
    const { enqueueCompanyResearchJob } = await import("../queues/companyResearchQueue.js");
    await enqueueCompanyResearchJob({
      jobId,
      companyId: record.companyId,
      companyName: record.companyName,
      field: record.field,
      role: record.role,
      country: record.country,
      maxSources: input.maxSources,
      searchDepth: input.searchDepth,
    });
  } catch (error) {
    console.error("[company-research] enqueue failed", { jobId, code: error?.code || "enqueue_failed" });
    await markResearchJobFailed(jobId, error).catch(() => {});
    const wrapped = new Error("Research could not be started.");
    wrapped.code = "job_store_failed";
    throw wrapped;
  }

  return { jobId, status: "queued" };
}

export async function markResearchJobRunning(jobId) {
  const current = await getResearchJob(jobId);
  if (!current) {
    const error = new Error("Research job was not found.");
    error.code = "invalid_input";
    throw error;
  }
  if (current.status === "review" || current.status === "published") return current;
  const running = {
    ...current,
    status: "running",
    startedAt: current.startedAt || new Date().toISOString(),
    error: null,
  };
  await writeJob(running);
  return running;
}

export async function markResearchJobReview(jobId, result) {
  const current = await getResearchJob(jobId);
  if (!current || current.status === "review" || current.status === "published") return current;
  const review = {
    ...current,
    status: "review",
    completedAt: new Date().toISOString(),
    result: withoutPageContent(result),
    error: null,
  };
  await writeJob(review);
  return review;
}

export async function markResearchJobFailed(jobId, error) {
  const current = await getResearchJob(jobId);
  if (!current || current.status === "review" || current.status === "published") return current;
  const failed = {
    ...current,
    status: "failed",
    completedAt: new Date().toISOString(),
    result: null,
    error: safeResearchError(error),
  };
  await writeJob(failed);
  return failed;
}

export async function markResearchJobSourcesPublished(jobId, summary) {
  const current = await getResearchJob(jobId);
  if (!current) {
    const error = new Error("Research job was not found.");
    error.code = "job_not_found";
    throw error;
  }
  if (current.status === "published") return current;
  const updated = {
    ...current,
    sourcesPublication: {
      publishedAt: new Date().toISOString(),
      insertedSourceCount: Number(summary?.insertedSourceCount) || 0,
      duplicateSourceCount: Number(summary?.duplicateSourceCount) || 0,
    },
    error: null,
  };
  await writeJob(updated);
  return updated;
}

export async function replaceResearchJobResultItems(jobId, items) {
  const current = await getResearchJob(jobId);
  if (!current) {
    const error = new Error("Research job was not found.");
    error.code = "job_not_found";
    throw error;
  }
  if (current.status !== "review") {
    const error = new Error("Research job is not in review.");
    error.code = "not_reviewable";
    throw error;
  }
  const updated = {
    ...current,
    result: {
      ...current.result,
      items: Array.isArray(items) ? items : [],
    },
  };
  await writeJob(updated);
  return updated;
}

export async function setResearchJobLinksSummaryDraft(jobId, draft) {
  const current = await getResearchJob(jobId);
  if (!current) {
    const error = new Error("Research job was not found.");
    error.code = "job_not_found";
    throw error;
  }
  if (current.status !== "review") {
    const error = new Error("Research job is not in review.");
    error.code = "not_reviewable";
    throw error;
  }
  const summary = String(draft?.summary || "").replace(/\s+/g, " ").trim();
  const prepRoleKey = String(draft?.prepRoleKey ?? "");
  const updated = {
    ...current,
    linksSummaryDraft: summary
      ? {
          prepRoleKey,
          summary,
          updatedAt: new Date().toISOString(),
        }
      : null,
  };
  await writeJob(updated);
  return updated;
}

export async function markResearchJobPublished(jobId, summary) {
  const current = await getResearchJob(jobId);
  if (!current) {
    const error = new Error("Research job was not found.");
    error.code = "job_not_found";
    throw error;
  }
  if (current.status === "published") return current;
  const published = {
    ...current,
    status: "published",
    publishedAt: new Date().toISOString(),
    publication: {
      insertedCount: Number(summary?.insertedCount) || 0,
      duplicateCount: Number(summary?.duplicateCount) || 0,
      insertedSourceCount: Number(summary?.insertedSourceCount) || 0,
      duplicateSourceCount: Number(summary?.duplicateSourceCount) || 0,
    },
    error: null,
  };
  await writeJob(published);
  return published;
}
