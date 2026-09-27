import { Queue } from "bullmq";
import { redisUrl } from "../../src/utils/redisClient.js";

/** Separate from interview, execution, and notification queues. */
export const COMPANY_RESEARCH_QUEUE = "company-research-queue";
export const RUN_COMPANY_RESEARCH = "run-company-research";

const connection = redisUrl ? { url: redisUrl } : {};

export const companyResearchQueue = new Queue(COMPANY_RESEARCH_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

/**
 * @param {{ jobId: string, companyId: string, companyName: string, field: string, role: string, country: string, maxSources: number, searchDepth: string }} payload
 */
export async function enqueueCompanyResearchJob(payload) {
  return companyResearchQueue.add(RUN_COMPANY_RESEARCH, payload, {
    jobId: payload.jobId,
  });
}
