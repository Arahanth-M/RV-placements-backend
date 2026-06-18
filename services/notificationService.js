import mongoose from "mongoose";
import Notification1, {
  NOTIFICATIONS1_COLLECTION,
} from "../models/Notification1.js";
import { publishNotificationSse } from "./realtime/notificationEmitter.js";

const MAX_LIMIT = 100;

function parseObjectId(id) {
  if (id == null) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

function normalizeLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return 20;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/**
 * @param {object} data — fields for Notification.create
 * @returns {Promise<object|null>} created doc, or null on duplicate key (eventId unique)
 */
export async function createNotification(data) {
  try {
    const doc = await Notification1.create(data);
    try {
      await publishNotificationSse(doc.userId.toString(), {
        type: "NEW_NOTIFICATION",
        notification: doc.toJSON(),
      });
    } catch (emitErr) {
      console.error("[notifications] SSE publish failed:", emitErr?.message || emitErr);
    }
    return doc;
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }
}

/**
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {{ cursor?: string|null, limit?: number }} options
 */
export async function getUserNotifications(userId, { cursor, limit } = {}) {
  const uid = parseObjectId(userId);
  if (!uid) {
    return {
      notifications: [],
      pageInfo: { nextCursor: null, hasNextPage: false },
    };
  }

  const take = normalizeLimit(limit);
  const fetchSize = take + 1;

  const now = new Date();

  const filter = {
    userId: uid,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: now } },
    ],
  };
  const cursorOid = cursor ? parseObjectId(cursor) : null;
  if (cursor && !cursorOid) {
    return {
      notifications: [],
      pageInfo: { nextCursor: null, hasNextPage: false },
    };
  }
  if (cursorOid) {
    filter._id = { $lt: cursorOid };
  }

  const rows = await Notification1.find(filter)
    .select("-__v")
    .sort({ _id: -1 })
    .limit(fetchSize)
    .lean();

  const hasNextPage = rows.length > take;
  const slice = hasNextPage ? rows.slice(0, take) : rows;
  const nextCursor =
    hasNextPage && slice.length > 0
      ? String(slice[slice.length - 1]._id)
      : null;

  return {
    notifications: slice,
    pageInfo: {
      nextCursor,
      hasNextPage,
    },
  };
}

export async function getUnreadCount(userId) {
  const uid = parseObjectId(userId);
  if (!uid) return 0;

  return Notification1.countDocuments({
    userId: uid,
    status: "unread",
  });
}

export async function markAsSeen(notificationId, userId) {
  const nid = parseObjectId(notificationId);
  const uid = parseObjectId(userId);
  if (!nid || !uid) return null;

  const updated = await Notification1.findOneAndUpdate(
    { _id: nid, userId: uid },
    { $set: { status: "seen", seenAt: new Date() } },
    { new: true }
  ).lean();

  return updated;
}

export async function markAllAsSeen(userId) {
  const uid = parseObjectId(userId);
  if (!uid) {
    return { modifiedCount: 0 };
  }

  const now = new Date();
  const result = await Notification1.updateMany(
    { userId: uid, status: "unread" },
    { $set: { status: "seen", seenAt: now } }
  );

  return { modifiedCount: result.modifiedCount };
}

export async function deleteNotification(notificationId, userId) {
  const nid = parseObjectId(notificationId);
  const uid = parseObjectId(userId);
  if (!nid || !uid) return null;

  const deleted = await Notification1.findOneAndDelete({
    _id: nid,
    userId: uid,
  }).lean();

  return deleted;
}

export async function clearAllNotifications(userId) {
  const uid = parseObjectId(userId);
  if (!uid) {
    return { deletedCount: 0 };
  }

  const result = await Notification1.deleteMany({ userId: uid });
  return { deletedCount: result.deletedCount };
}

export { NOTIFICATIONS1_COLLECTION };
