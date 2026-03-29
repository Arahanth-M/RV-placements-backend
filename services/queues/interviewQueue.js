import { Queue } from "bullmq";
import { redisUrl } from "../../src/utils/redisClient.js";
import { INTERVIEW_QUEUE } from "./jobTypes.js";

/**
 * BullMQ uses its own ioredis connections; `connection` reuses the same REDIS_URL as redisClient.
 */
export const interviewQueue = new Queue(INTERVIEW_QUEUE, {
  connection: redisUrl ? { url: redisUrl } : {},
});
