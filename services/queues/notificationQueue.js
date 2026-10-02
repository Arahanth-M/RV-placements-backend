import { Queue } from "bullmq";
import { redisUrl } from "../../src/utils/redisClient.js";

const connection = redisUrl ? { url: redisUrl } : {};

const notificationQueue = new Queue("notificationQueue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

/**
 * @param {object} data — notification payload (must include eventId for dedupe/jobId)
 * @param {{ delayMs?: number, jobId?: string }} [opts]
 */
export async function enqueueNotificationJob(data, opts = {}) {
  if (!data?.eventId) {
    console.warn("Missing eventId in notification job", data);
  }
  const jobId = opts.jobId || data.eventId;
  const options = { jobId };
  const delayMs = Number(opts.delayMs);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    options.delay = Math.floor(delayMs);
  }
  return notificationQueue.add("send_notification", data, options);
}

/** Remove a pending/delayed job by id (no-op if missing). */
export async function cancelNotificationJob(jobId) {
  const id = String(jobId || "").trim();
  if (!id) return false;
  try {
    const job = await notificationQueue.getJob(id);
    if (!job) return false;
    await job.remove();
    return true;
  } catch (err) {
    console.warn("[notificationQueue] cancel failed:", id, err?.message || err);
    return false;
  }
}

export { notificationQueue };
