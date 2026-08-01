import { EVENT_TYPES } from "./eventTypes.js";
import { enqueueNotificationJob } from "../queues/notificationQueue.js";
import User1 from "../../models/User1.js";
import CompanyStatic from "../../models/CompanyStatic.js";
import { findEmailSubscribersCursor } from "../notificationPreferenceService.js";
import { sendSubscriberUpdateEmailWebhook } from "../webhookService.js";

const BATCH_SIZE = 100;

async function processApprovedBatch(batch, companyId, companyName) {
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

async function processUpdatedBatch(batch, companyId, companyName, updateKey, body) {
  const companyIdStr = String(companyId);
  const key = String(updateKey || Date.now());
  const results = await Promise.all(
    batch.map((user) => {
      const eventId = `COMPANY_UPDATED_${companyIdStr}_${String(user._id)}_${key}`;
      return enqueueNotificationJob({
        userId: user._id,
        type: EVENT_TYPES.COMPANY_UPDATED,
        title: `${companyName} updated`,
        body:
          body ||
          `New details were added for ${companyName}. Open the company page to see what's new.`,
        payload: { companyId, companyName },
        eventId,
      });
    })
  );

  return results.filter(Boolean).length;
}

async function processEventCreatedBatch(batch, { eventId, eventTitle, eventUrl }) {
  const eventIdStr = String(eventId);
  const results = await Promise.all(
    batch.map((user) => {
      const dedupeKey = `EVENT_CREATED_${eventIdStr}_${String(user._id)}`;
      return enqueueNotificationJob({
        userId: user._id,
        type: EVENT_TYPES.EVENT_CREATED,
        title: `New event: ${eventTitle}`,
        body: "A new event/announcement was added. Open Events to view details.",
        payload: { eventId, eventTitle, eventUrl },
        eventId: dedupeKey,
      });
    })
  );

  return results.filter(Boolean).length;
}

async function fanOutInApp(cursor, processBatchFn) {
  const batch = [];
  let createdCount = 0;

  try {
    for await (const user of cursor) {
      batch.push(user);

      if (batch.length === BATCH_SIZE) {
        createdCount += await processBatchFn(batch);
        batch.length = 0;
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    if (batch.length > 0) {
      createdCount += await processBatchFn(batch);
    }
  } finally {
    if (typeof cursor.close === "function") {
      await cursor.close().catch(() => {});
    }
  }

  return createdCount;
}

/**
 * Email opt-in users only (Subscribe button). Does not affect in-app notifications.
 */
async function emailSubscribers(fields) {
  const cursor = findEmailSubscribersCursor();
  const batch = [];

  async function flush(rows) {
    await Promise.all(
      rows.map((user) =>
        sendSubscriberUpdateEmailWebhook({
          email: user.email,
          username: user.username || "",
          ...fields,
        })
      )
    );
  }

  try {
    for await (const user of cursor) {
      if (!user?.email) continue;
      batch.push(user);
      if (batch.length >= BATCH_SIZE) {
        await flush(batch);
        batch.length = 0;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    if (batch.length > 0) {
      await flush(batch);
    }
  } finally {
    if (typeof cursor.close === "function") {
      await cursor.close().catch(() => {});
    }
  }
}

async function handleCompanyApproved(payload) {
  const { companyId, companyName } = payload || {};
  if (!companyId) return;
  const name =
    (companyName && String(companyName).trim()) || "A company on the platform";

  const allUsersCursor = User1.find({}).select("_id").lean().cursor();
  await fanOutInApp(allUsersCursor, (batch) =>
    processApprovedBatch(batch, companyId, name)
  );

  await emailSubscribers({
    type: EVENT_TYPES.COMPANY_APPROVED,
    companyId,
    companyName: name,
    body: "A new company was approved on the RVCE Placement platform.",
  });
}

async function handleCompanyUpdated(payload) {
  const { companyId, companyName, updateKey, body } = payload || {};
  if (!companyId) return;

  let name = companyName && String(companyName).trim();
  if (!name) {
    try {
      const doc = await CompanyStatic.findById(companyId).select("name").lean();
      name = (doc?.name && String(doc.name).trim()) || "A company on the platform";
    } catch {
      name = "A company on the platform";
    }
  }

  const message =
    body ||
    `New details were added for ${name}. Open the company page to see what's new.`;

  const allUsersCursor = User1.find({}).select("_id").lean().cursor();
  await fanOutInApp(allUsersCursor, (batch) =>
    processUpdatedBatch(batch, companyId, name, updateKey, message)
  );

  await emailSubscribers({
    type: EVENT_TYPES.COMPANY_UPDATED,
    companyId,
    companyName: name,
    body: message,
  });
}

async function handleEventCreated(payload) {
  const { eventId, eventTitle, eventUrl } = payload || {};
  if (!eventId) return;
  const title =
    (eventTitle && String(eventTitle).trim()) || "A new event on the platform";
  const url = eventUrl != null ? String(eventUrl).trim() : "";

  const allUsersCursor = User1.find({}).select("_id").lean().cursor();
  await fanOutInApp(allUsersCursor, (batch) =>
    processEventCreatedBatch(batch, { eventId, eventTitle: title, eventUrl: url })
  );

  await emailSubscribers({
    type: EVENT_TYPES.EVENT_CREATED,
    eventId,
    eventTitle: title,
    eventUrl: url,
    body: `A new event was added: ${title}`,
  });
}

export function dispatchEvent(eventType, payload) {
  switch (eventType) {
    case EVENT_TYPES.COMPANY_APPROVED:
      handleCompanyApproved(payload).catch((err) =>
        console.error("EVENT_HANDLER_FAILED", err)
      );
      break;
    case EVENT_TYPES.COMPANY_UPDATED:
      handleCompanyUpdated(payload).catch((err) =>
        console.error("EVENT_HANDLER_FAILED", err)
      );
      break;
    case EVENT_TYPES.EVENT_CREATED:
      handleEventCreated(payload).catch((err) =>
        console.error("EVENT_HANDLER_FAILED", err)
      );
      break;
    default:
      console.warn(`Unknown event type: ${eventType}`);
  }
}
