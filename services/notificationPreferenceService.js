import mongoose from "mongoose";
import User1 from "../models/User1.js";

function toObjectId(id) {
  if (id == null) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

/**
 * Email-subscription preference (Subscribe button).
 * In-app notifications are sent to everyone and are unrelated to this flag.
 * @param {string|import("mongoose").Types.ObjectId} userId
 */
export async function getNotificationSubscriptionStatus(userId) {
  const uid = toObjectId(userId);
  if (!uid) return { subscribed: false };

  const doc = await User1.findById(uid).select("notificationsSubscribed").lean();
  return { subscribed: doc?.notificationsSubscribed === true };
}

/**
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @param {boolean} subscribed
 */
export async function setNotificationSubscription(userId, subscribed) {
  const uid = toObjectId(userId);
  if (!uid) {
    return { ok: false, reason: "invalid_input", subscribed: false };
  }

  const doc = await User1.findByIdAndUpdate(
    uid,
    { $set: { notificationsSubscribed: subscribed === true } },
    { new: true, select: "notificationsSubscribed" }
  ).lean();

  if (!doc) {
    return { ok: false, reason: "not_found", subscribed: false };
  }

  return { ok: true, subscribed: doc.notificationsSubscribed === true };
}

/**
 * Cursor of users opted in for email updates (not in-app).
 */
export function findEmailSubscribersCursor() {
  return User1.find({ notificationsSubscribed: true })
    .select("_id email username")
    .lean()
    .cursor();
}

/** @deprecated use findEmailSubscribersCursor */
export function findNotificationSubscribersCursor() {
  return findEmailSubscribersCursor();
}
