import { Queue, QueueEvents } from "bullmq";
import { redisUrl } from "../../src/utils/redisClient.js";

export const EXECUTION_QUEUE = "execution-queue";
export const EXECUTE_DSA = "execute-dsa";

const connection = redisUrl ? { url: redisUrl } : {};

export const executionQueue = new Queue(EXECUTION_QUEUE, {
  connection,
});
const executionQueueEvents = new QueueEvents(EXECUTION_QUEUE, { connection });

/**
 * Enqueue a code/sql execution job.
 * Logs enqueue/completion/failure for observability.
 */
export const addExecutionJob = async (jobName, payload, options = {}) => {
  const allowed = new Set([EXECUTE_DSA]);
  if (!allowed.has(jobName)) {
    throw new Error(`[executionQueue] Unsupported job type: ${jobName}`);
  }

  const job = await executionQueue.add(jobName, payload, options);
  console.log("[executionQueue] enqueue", {
    queue: EXECUTION_QUEUE,
    jobId: job.id,
    jobName,
  });

  // Fire-and-forget completion/failure logging for the enqueued job.
  Promise.resolve(job.waitUntilFinished(executionQueueEvents))
    .then((result) => {
      console.log("[executionQueue] job completion", {
        queue: EXECUTION_QUEUE,
        jobId: job.id,
        jobName,
        status: result?.status || "completed",
      });
    })
    .catch((error) => {
      console.error("[executionQueue] job failure", {
        queue: EXECUTION_QUEUE,
        jobId: job.id,
        jobName,
        error: error?.message || error,
      });
    });

  return job;
};

export default executionQueue;
