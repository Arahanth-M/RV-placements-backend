import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import { connectRedis, redisUrl } from "../src/utils/redisClient.js";
import { connectDB } from "../config/db.js";
import { config } from "../config/constants.js";
import { EXECUTION_QUEUE, EXECUTE_DSA } from "../services/queues/executionQueue.js";
import { executeCode } from "../services/codeExecution/executeCode.js";

await connectDB(config.MONGO_URI);
await connectRedis().catch(() => {});

const connection = redisUrl ? { url: redisUrl } : {};
const concurrency = Number(process.env.EXECUTION_CONCURRENCY || 1);

console.log("[executionWorker] worker startup", {
  queue: EXECUTION_QUEUE,
  concurrency,
});

const processor = async (job) => {
  const jobName = job?.name;
  console.log("[executionWorker] execution started", {
    id: job?.id,
    jobName,
  });

  try {
    let result;
    if (jobName === EXECUTE_DSA) {
      result = await executeCode(job?.data || {});
    } else {
      throw new Error(`Unsupported execution job: ${jobName}`);
    }

    console.log("[executionWorker] execution completed", {
      id: job?.id,
      jobName,
      status: result?.status || "unknown",
      passedCount: result?.passedCount,
      failedCount: result?.failedCount,
    });
    return result;
  } catch (error) {
    console.error("[executionWorker] execution failed", {
      id: job?.id,
      jobName,
      error: error?.message || error,
    });
    throw error;
  }
};

export const executionWorker = new Worker(EXECUTION_QUEUE, processor, {
  connection,
  concurrency,
});

executionWorker.on("completed", (job) => {
  console.log("[executionWorker] job completed", { id: job.id, name: job.name });
});

executionWorker.on("failed", (job, err) => {
  console.error("[executionWorker] job failed", {
    id: job?.id,
    name: job?.name,
    error: err?.message || err,
  });
});

executionWorker.on("error", (err) => {
  console.error("[executionWorker] worker error", err?.message || err);
});

export default executionWorker;
