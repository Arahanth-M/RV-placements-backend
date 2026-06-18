import mongoose from "mongoose";

/** Physical MongoDB collection for in-app notifications (legacy `notifications` is unused). */
export const NOTIFICATIONS1_COLLECTION = "notifications1";

/** Status lifecycle for inbox-style notifications */
const NOTIFICATION_STATUSES = ["unread", "seen", "archived"];

/** Delivery priority (UI ordering / future routing) */
const NOTIFICATION_PRIORITIES = ["low", "medium", "high"];

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /** Logical kind (e.g. new_company); string stays open-ended for new types */
    type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 10000,
    },
    /** Deep links, entity ids, extra metadata (e.g. { companyId }) */
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    channel: {
      type: String,
      trim: true,
      default: "in_app",
      maxlength: 32,
    },
    priority: {
      type: String,
      enum: NOTIFICATION_PRIORITIES,
      default: "medium",
    },
    status: {
      type: String,
      enum: NOTIFICATION_STATUSES,
      default: "unread",
    },
    seenAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: undefined,
    },
    /**
     * Idempotency / dedupe key for an event (e.g. one key per approved company fan-out).
     * Sparse index: documents may omit until backfilled.
     */
    eventId: {
      type: String,
      trim: true,
      maxlength: 256,
    },
  },
  { timestamps: true, collection: NOTIFICATIONS1_COLLECTION }
);

notificationSchema.index({ userId: 1, status: 1, createdAt: -1 });
notificationSchema.index({ userId: 1 });
notificationSchema.index({ eventId: 1 }, { unique: true, sparse: true });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

function attachLegacyApiShape(ret) {
  if (!ret || typeof ret !== "object") return ret;
  ret.isSeen = ret.status === "seen";
  if (ret.body != null) ret.message = ret.body;
  const cid =
    ret.payload && typeof ret.payload === "object" && ret.payload !== null
      ? ret.payload.companyId
      : undefined;
  if (cid != null) ret.companyId = cid;
  return ret;
}

notificationSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    return attachLegacyApiShape(ret);
  },
});

notificationSchema.set("toObject", {
  virtuals: true,
  transform(_doc, ret) {
    return attachLegacyApiShape(ret);
  },
});

const Notification1 =
  mongoose.models.Notification1 ||
  mongoose.model("Notification1", notificationSchema, NOTIFICATIONS1_COLLECTION);

export default Notification1;
