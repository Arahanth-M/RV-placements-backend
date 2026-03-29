import { QueueEvents } from "bullmq";
import { redisUrl } from "../../src/utils/redisClient.js";
import { INTERVIEW_QUEUE } from "./jobTypes.js";

const connection = redisUrl ? { url: redisUrl } : {};

export const interviewQueueEvents = new QueueEvents(INTERVIEW_QUEUE, {
  connection,
});
