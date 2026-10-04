import { randomUUID } from "node:crypto";
import { addToSet, getJSON, getSetMembers, setJSON } from "../../src/utils/redisHelpers.js";
import { isTokenLimitError, publicProviderMessage } from "../../utils/publicProviderError.js";

/** Abandoned research jobs expire on their own. */
export const RESEARCH_JOB_TTL_SECONDS = 24 * 60 * 60;

export const RESEARCH_JOB_KEY_PREFIX = "company-research:job:";

/** Latest job ids per company, content field, and role, so review data survives leaving the page. */
export const RESEARCH_ACTIVE_KEY_PREFIX = "company-research:active:";

const RESEARCH_FIELDS = ["interviewQuestions", "onlineQuestions", "interviewExperiences"];

const COMPANY_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAFE_ERROR_MESSAGES = Object.freeze({
  invalid_input: "Research input was not valid.",
  search_failed: "Research could not be completed.",
  research_failed: "Research could not be completed.",
});

export function researchJobKey(jobId) {
  return `${RESEARCH_JOB_KEY_PREFIX}${jobId}`;
}

export function isResearchCompanyId(companyId) {
  return COMPANY_ID_RE.test(String(companyId || ""));
}

export function roleSlotToken(role) {
  const token = String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return token || "general";
}

export function activeResearchKey(companyId, field, role = "") {
  return `${RESEARCH_ACTIVE_KEY_PREFIX}${companyId}:${field}:${roleSlotToken(role)}`;
}

export function activeRoleSetKey(companyId) {
  return `${RESEARCH_ACTIVE_KEY_PREFIX}roles:${companyId}`;
}

export function researchLinksAlreadyPublished(job) {
  return Boolean(job?.sourcesPublication?.publishedAt);
}

/** Interview-question jobs stay link-editable in review and after questions are published. */
export function canManageResearchLinks(job) {
  if (!job || job.field !== "interviewQuestions") return false;
  if (!Array.isArray(job.result?.sources)) return false;
  if (researchLinksAlreadyPublished(job)) return false;
  return job.status === "review" || job.status === "published";
}

export function safeResearchError(error) {
  const code = Object.prototype.hasOwnProperty.call(SAFE_ERROR_MESSAGES, error?.code)
    ? error.code
    : "research_failed";
  const message = publicProviderMessage(error, SAFE_ERROR_MESSAGES[code]);
  const tokenLimit = isTokenLimitError(error?.message) || isTokenLimitError(message);
  const secretId = tokenLimit ? (code === "search_failed" ? "tavily" : "groq-web-search") : "";
  return {
    code,
    message,
    ...(tokenLimit ? { tokenLimit: true, secretId } : {}),
  };
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

async function rememberActiveResearchJob(record) {
  if (!isResearchCompanyId(record?.companyId) || !RESEARCH_FIELDS.includes(record?.field)) return;
  const ok = await setJSON(
    activeResearchKey(record.companyId, record.field, record.role),
    { jobId: record.jobId },
    RESEARCH_JOB_TTL_SECONDS
  );
  const indexed = await addToSet(
    activeRoleSetKey(record.companyId),
    record.jobId,
    RESEARCH_JOB_TTL_SECONDS
  );
  if (!ok || !indexed) {
    console.error("[company-research] active job index could not be stored", { jobId: record.jobId });
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
 * Latest research job for each content field and role on a company.
 * In-progress jobs stay here while the admin works on other companies.
 * @param {string} companyId
 */
export async function listCompanyResearchJobs(companyId) {
  if (!isResearchCompanyId(companyId)) return [];
  const ids = new Set(await getSetMembers(activeRoleSetKey(companyId)));
  for (const field of RESEARCH_FIELDS) {
    const legacy = await getJSON(`${RESEARCH_ACTIVE_KEY_PREFIX}${companyId}:${field}`);
    const jobId = typeof legacy?.jobId === "string" ? legacy.jobId : "";
    if (jobId) ids.add(jobId);
  }
  const jobs = [];
  for (const jobId of ids) {
    const job = await getResearchJob(jobId);
    if (!job || job.companyId !== companyId || !RESEARCH_FIELDS.includes(job.field)) continue;
    jobs.push(job);
  }
  const latest = new Map();
  for (const job of jobs) {
    const key = `${job.field}:${roleSlotToken(job.role)}`;
    const previous = latest.get(key);
    if (!previous || String(job.createdAt || "") >= String(previous.createdAt || "")) {
      latest.set(key, job);
    }
  }
  return [...latest.values()];
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
  await rememberActiveResearchJob(record);

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
  if (researchLinksAlreadyPublished(current)) return current;
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

const ITEM_TEXT_LIMITS = Object.freeze({
  question: 4000,
  content: 12000,
  answer: 8000,
  intuition: 8000,
  option: 1000,
  solution: 20000,
});

function itemUpdateError(code, message, status) {
  const error = new Error(message);
  error.name = "ResearchItemUpdateError";
  error.code = code;
  error.status = status;
  return error;
}

function editedText(value, max, label) {
  if (typeof value !== "string") {
    throw itemUpdateError("invalid_item", `${label} must be text.`, 400);
  }
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text.length > max) {
    throw itemUpdateError("invalid_item", `${label} is too long.`, 400);
  }
  return text;
}

function applyResearchItemPatch(field, item, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw itemUpdateError("invalid_item", "Edit was not valid.", 400);
  }
  const next = { ...item };

  if (field === "interviewExperiences") {
    if (!Object.prototype.hasOwnProperty.call(patch, "content")) {
      throw itemUpdateError("invalid_item", "Experience text is required.", 400);
    }
    const content = editedText(patch.content, ITEM_TEXT_LIMITS.content, "Experience");
    if (!content) throw itemUpdateError("invalid_item", "Experience text is required.", 400);
    next.content = content;
    return next;
  }

  let changed = false;
  if (Object.prototype.hasOwnProperty.call(patch, "question")) {
    const question = editedText(patch.question, ITEM_TEXT_LIMITS.question, "Question");
    if (!question) throw itemUpdateError("invalid_item", "Question text is required.", 400);
    next.question = question;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "answer")) {
    next.answer = editedText(patch.answer, ITEM_TEXT_LIMITS.answer, "Answer");
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "intuition")) {
    next.intuition = editedText(patch.intuition, ITEM_TEXT_LIMITS.intuition, "Intuition");
    changed = true;
  }
  if (patch.solutions && typeof patch.solutions === "object" && !Array.isArray(patch.solutions)) {
    const previous = next.solutions && typeof next.solutions === "object" ? next.solutions : {};
    next.solutions = {
      cpp: editedText(
        patch.solutions.cpp != null ? patch.solutions.cpp : String(previous.cpp || ""),
        ITEM_TEXT_LIMITS.solution,
        "C++ solution"
      ),
      java: editedText(
        patch.solutions.java != null ? patch.solutions.java : String(previous.java || ""),
        ITEM_TEXT_LIMITS.solution,
        "Java solution"
      ),
      python: editedText(
        patch.solutions.python != null ? patch.solutions.python : String(previous.python || ""),
        ITEM_TEXT_LIMITS.solution,
        "Python solution"
      ),
    };
    changed = true;
  }
  if (item?.form === "mcq" && item.mcqMetadata && typeof item.mcqMetadata === "object") {
    const meta = { ...item.mcqMetadata };
    if (Array.isArray(patch.options)) {
      const byId = new Map(
        patch.options
          .filter((opt) => opt && typeof opt === "object")
          .map((opt) => [String(opt.id || "").trim().toUpperCase(), opt.text])
      );
      const options = (Array.isArray(meta.options) ? meta.options : []).map((opt) => {
        const id = String(opt?.id || "").trim().toUpperCase();
        if (!byId.has(id)) return opt;
        const text = editedText(String(byId.get(id) ?? ""), ITEM_TEXT_LIMITS.option, `Option ${id}`);
        if (!text) throw itemUpdateError("invalid_item", `Option ${id} is required.`, 400);
        return { ...opt, id, text };
      });
      meta.options = options;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "correctOptionId")) {
      const correctOptionId = String(patch.correctOptionId || "").trim().toUpperCase();
      const options = Array.isArray(meta.options) ? meta.options : [];
      if (!correctOptionId) {
        delete meta.correctOptionId;
      } else if (!options.some((opt) => String(opt?.id || "").toUpperCase() === correctOptionId)) {
        throw itemUpdateError("invalid_item", "Choose a valid correct option.", 400);
      } else {
        meta.correctOptionId = correctOptionId;
      }
      changed = true;
    }
    next.mcqMetadata = meta;
  }
  if (!changed) throw itemUpdateError("invalid_item", "Nothing to update.", 400);
  return next;
}

/**
 * Replace one review item's question, experience, or generated answer text.
 * @param {{ jobId?: string, index?: number, patch?: object }} input
 */
export async function updateResearchJobItem(input = {}) {
  const jobId = String(input.jobId || "").trim();
  const index = input.index;
  const current = await getResearchJob(jobId);
  if (!current) throw itemUpdateError("job_not_found", "Research job was not found.", 404);
  if (current.status !== "review") {
    throw itemUpdateError("not_reviewable", "Research job is not in review.", 409);
  }
  if (!Array.isArray(current.result?.items)) {
    throw itemUpdateError("invalid_item", "Research job has no items to edit.", 400);
  }
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= current.result.items.length) {
    throw itemUpdateError("invalid_item", "That item was not found.", 400);
  }
  const items = current.result.items.map((row) => ({ ...row }));
  items[index] = applyResearchItemPatch(current.field, items[index], input.patch);
  await replaceResearchJobResultItems(jobId, items);
  return { jobId, index, item: items[index] };
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
  if (!canManageResearchLinks(current)) {
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
