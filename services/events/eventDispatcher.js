import { EVENT_TYPES } from "./eventTypes.js";
import { enqueueNotificationJob } from "../queues/notificationQueue.js";
import User1 from "../../models/User1.js";

const BATCH_SIZE = 100;

async function processBatch(batch, companyId, companyName) {
  const companyIdStr = String(companyId);
  const results = await Promise.all(
    batch.map((user) => {
      const eventId = `COMPANY_APPROVED_${companyIdStr}_${String(user._id)}`;
      return enqueueNotificationJob({
        userId: user._id,
        type: EVENT_TYPES.COMPANY_APPROVED,
        title: `${companyName} approved`,
        body: "New company on the platform.",
        payload: { companyId, companyName },
        eventId,
      });
    })
  );

  return results.filter(Boolean).length;
}

async function handleCompanyApproved(payload) {
  const { companyId, companyName } = payload || {};
  if (!companyId) return;
  const name =
    (companyName && String(companyName).trim()) || "A company on the platform";

  // Fan-out to all platform accounts (students, SPCs, and admins — all use `users1`).
  const cursor = User1.find({})
    .select("_id")
    .lean()
    .cursor();

  const batch = [];
  let createdCount = 0;

  try {
    for await (const user of cursor) {
      batch.push(user);

      if (batch.length === BATCH_SIZE) {
        createdCount += await processBatch(batch, companyId, name);
        batch.length = 0;

        await new Promise((r) => setTimeout(r, 50));
      }
    }

    if (batch.length > 0) {
      createdCount += await processBatch(batch, companyId, name);
    }
  } finally {
    if (typeof cursor.close === "function") {
      await cursor.close().catch(() => {});
    }
  }

  void createdCount;
}

export function dispatchEvent(eventType, payload) {
  switch (eventType) {
    case EVENT_TYPES.COMPANY_APPROVED:
      handleCompanyApproved(payload).catch((err) =>
        console.error("EVENT_HANDLER_FAILED", err)
      );
      break;
    default:
      console.warn(`Unknown event type: ${eventType}`);
  }
}
