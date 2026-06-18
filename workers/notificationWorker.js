import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import * as notificationService from "../services/notificationService.js";
import Notification1, {
  NOTIFICATIONS1_COLLECTION,
} from "../models/Notification1.js";
import { connectRedis, redisUrl } from "../src/utils/redisClient.js";
import { connectDB } from "../config/db.js";
import { config } from "../config/constants.js";

await connectDB(config.MONGO_URI);
await connectRedis().catch(() => {});

if (Notification1.collection.name !== NOTIFICATIONS1_COLLECTION) {
  throw new Error(
    `[notificationWorker] Wrong collection: expected ${NOTIFICATIONS1_COLLECTION}, got ${Notification1.collection.name}`
  );
}
console.log(
  `[notificationWorker] MongoDB notifications collection: ${Notification1.collection.name}`
);

const connection = redisUrl ? { url: redisUrl } : {};

const worker = new Worker(
  "notificationQueue",
  async (job) => {
    try {
      await notificationService.createNotification(job.data);
    } catch (err) {
      console.error("NOTIFICATION_JOB_FAILED", {
        jobId: job.id,
        error: err?.message ?? String(err),
      });
      throw err;
    }
  },
  { connection, concurrency: 10 }
);

worker.on("completed", (job) => {
  console.log("[notificationWorker] completed", { id: job.id, name: job.name });
});

worker.on("failed", (job, err) => {
  console.error("[notificationWorker] failed", {
    id: job?.id,
    name: job?.name,
    error: err?.message || err,
  });
});
