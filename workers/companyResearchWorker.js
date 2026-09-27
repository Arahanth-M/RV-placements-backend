import dotenv from "dotenv";
import { pathToFileURL } from "node:url";
import { researchInterviewQuestions } from "../services/companyResearch/researchInterviewQuestions.js";
import {
  markResearchJobFailed,
  markResearchJobReview,
  markResearchJobRunning,
  safeResearchError,
} from "../services/companyResearch/researchJobService.js";

/**
 * Run one research job. Exported for tests. Does not write MongoDB.
 * @param {{ data?: object }} job
 */
export async function processCompanyResearchJob(job) {
  const data = job?.data || {};
  try {
    const running = await markResearchJobRunning(data.jobId);
    if (running?.status === "review" || running?.status === "published") {
      return { jobId: data.jobId, status: running.status };
    }

    const result = await researchInterviewQuestions({
      companyName: data.companyName,
      role: data.role,
      country: data.country,
      maxSources: data.maxSources,
      searchDepth: data.searchDepth,
    });
    await markResearchJobReview(data.jobId, result);
    return { jobId: data.jobId, status: "review" };
  } catch (error) {
    const safe = safeResearchError(error);
    const stored = await markResearchJobFailed(data.jobId, error);
    if (stored?.status === "review" || stored?.status === "published") {
      return { jobId: data.jobId, status: stored.status };
    }
    console.error("[companyResearchWorker] job failed", {
      jobId: data.jobId,
      code: safe.code,
    });
    if (error?.code === "invalid_input") {
      const { UnrecoverableError } = await import("bullmq");
      throw new UnrecoverableError(safe.message);
    }
    const retryable = new Error(safe.message);
    retryable.code = safe.code;
    throw retryable;
  }
}

function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectExecution()) {
  dotenv.config();
  const { connectRedis, redisUrl } = await import("../src/utils/redisClient.js");
  const { Worker } = await import("bullmq");
  const { COMPANY_RESEARCH_QUEUE } = await import("../services/queues/companyResearchQueue.js");
  await connectRedis().catch(() => {});

  const connection = redisUrl ? { url: redisUrl } : {};
  const worker = new Worker(COMPANY_RESEARCH_QUEUE, processCompanyResearchJob, {
    connection,
    concurrency: 1,
  });

  worker.on("completed", (job) => {
    console.log("[companyResearchWorker] completed", { id: job.id, name: job.name });
  });

  worker.on("failed", (job, err) => {
    console.error("[companyResearchWorker] failed", {
      id: job?.id,
      name: job?.name,
      code: err?.code || "research_failed",
    });
  });
}
