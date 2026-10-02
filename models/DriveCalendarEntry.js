import mongoose from "mongoose";
import crypto from "crypto";

export const REMINDER_KINDS = [
  "none",
  "day_of",
  "day_before",
  "week_before",
  "custom",
];

export const REMINDER_CHANNELS = [
  "in_app",
  "email",
  "both",
  "whatsapp",
  "sms",
];

const checklistItemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true, maxlength: 200 },
    done: { type: Boolean, default: false },
  },
  { _id: false }
);

/**
 * Student preference only — notifications are sent manually later.
 * status: none | requested | sent
 */
const reminderPrefSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: REMINDER_KINDS,
      default: "none",
    },
    /** Where they want the reminder delivered (manual send for now). */
    channel: {
      type: String,
      enum: REMINDER_CHANNELS,
      default: "in_app",
    },
    /** Required for whatsapp / sms channels. */
    phone: { type: String, trim: true, maxlength: 20, default: "" },
    /** Free-text preference, especially for kind=custom */
    note: { type: String, trim: true, maxlength: 400, default: "" },
    status: {
      type: String,
      enum: ["none", "requested", "sent"],
      default: "none",
    },
  },
  { _id: false }
);

const driveCalendarEntrySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    userObjectId: { type: String, trim: true, default: "" },
    type: {
      type: String,
      enum: ["visit", "deadline", "note"],
      required: true,
      default: "visit",
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    companyName: { type: String, trim: true, maxlength: 160, default: "" },
    notes: { type: String, trim: true, maxlength: 2000, default: "" },
    dateKey: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    timeLabel: { type: String, trim: true, maxlength: 64, default: "" },
    checklist: {
      type: [checklistItemSchema],
      default: [],
      validate: {
        validator(v) {
          return !Array.isArray(v) || v.length <= 20;
        },
        message: "Checklist can have at most 20 items",
      },
    },
    reminder: {
      type: reminderPrefSchema,
      default: () => ({
        kind: "none",
        channel: "in_app",
        phone: "",
        note: "",
        status: "none",
      }),
    },
  },
  { timestamps: true }
);

driveCalendarEntrySchema.index({ userId: 1, dateKey: 1 });
driveCalendarEntrySchema.index({ "reminder.status": 1, "reminder.kind": 1, "reminder.channel": 1 });

export function newChecklistItemId() {
  return crypto.randomBytes(6).toString("hex");
}

export default mongoose.models.DriveCalendarEntry ||
  mongoose.model("DriveCalendarEntry", driveCalendarEntrySchema, "drive_calendar_entries");
