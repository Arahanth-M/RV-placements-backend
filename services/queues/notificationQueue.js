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

export async function enqueueNotificationJob(data) {
  if (!data?.eventId) {
    console.warn("Missing eventId in notification job", data);
  }
  return notificationQueue.add("send_notification", data, {
    jobId: data.eventId,
  });
}
