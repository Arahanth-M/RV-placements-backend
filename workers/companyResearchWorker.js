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
    const { loadRuntimeSecrets } = await import("../services/platformRuntimeSecrets.js");
    await loadRuntimeSecrets().catch(() => {});
    const running = await markResearchJobRunning(data.jobId);
    if (running?.status === "review" || running?.status === "published") {
      return { jobId: data.jobId, status: running.status };
    }

    const researchInput = {
      companyName: data.companyName,
      role: data.role,
      country: data.country,
      maxSources: data.maxSources,
      searchDepth: data.searchDepth,
    };
    let result;
    if (data.field === "onlineQuestions") {
      const { researchOnlineQuestions } = await import(
        "../services/companyResearch/researchOnlineQuestions.js"
      );
      result = await researchOnlineQuestions(researchInput);
    } else if (data.field === "interviewExperiences") {
      const { researchInterviewExperiences } = await import(
        "../services/companyResearch/researchInterviewExperiences.js"
      );
      result = await researchInterviewExperiences(researchInput);
    } else {
      result = await researchInterviewQuestions(researchInput);
    }
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

/** Several companies can be scraped at once. Override with COMPANY_RESEARCH_WORKER_CONCURRENCY (1–8). */
export function companyResearchConcurrency() {
  const raw = Number(process.env.COMPANY_RESEARCH_WORKER_CONCURRENCY);
  if (Number.isInteger(raw) && raw >= 1 && raw <= 8) return raw;
  return 3;
}

let startPromise = null;

/**
 * Start the BullMQ consumer in this process. The API server calls this so
 * production does not depend on a separate worker process. Safe to call once.
 */
export function startCompanyResearchWorker() {
  if (!startPromise) {
    startPromise = (async () => {
      const { Worker } = await import("bullmq");
      const { COMPANY_RESEARCH_QUEUE } = await import("../services/queues/companyResearchQueue.js");
      const { redisUrl } = await import("../src/utils/redisClient.js");
      const connection = redisUrl ? { url: redisUrl } : {};
      const worker = new Worker(COMPANY_RESEARCH_QUEUE, processCompanyResearchJob, {
        connection,
        concurrency: companyResearchConcurrency(),
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

      worker.on("error", (err) => {
        console.error("[companyResearchWorker] worker error:", err?.message || err);
      });

      return worker;
    })();
  }
  return startPromise;
}

if (isDirectExecution()) {
  dotenv.config();
  const { connectRedis } = await import("../src/utils/redisClient.js");
  await connectRedis().catch(() => {});
  const { loadRuntimeSecrets } = await import("../services/platformRuntimeSecrets.js");
  await loadRuntimeSecrets().catch(() => {});
  await startCompanyResearchWorker();
}
