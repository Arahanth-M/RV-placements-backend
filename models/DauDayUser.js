import mongoose from "mongoose";

/**
 * One row per (day, user). Inserted on login/activity.
 * Does not modify users1 — additive tracking only.
 */
const dauDayUserSchema = new mongoose.Schema(
  {
    dayKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    email: { type: String, trim: true, default: "" },
    username: { type: String, trim: true, default: "" },
    role: { type: String, trim: true, default: "" },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    /** Coarse activity keys for that day. Optional — existing rows have no field. */
    actions: { type: [String], default: undefined },
    /** Unique company names opened that day. Optional — existing rows have no field. */
    openedCompanies: { type: [String], default: undefined },
    /** Unique company names a PrepPath was generated for that day. Optional. */
    prepPathCompanies: { type: [String], default: undefined },
    /** Engaged milliseconds that day. Optional — $inc only, never backfilled. */
    activeMs: { type: Number, default: undefined },
  },
  {
    timestamps: true,
    collection: "dau_day_users",
  }
);

dauDayUserSchema.index({ dayKey: 1, userId: 1 }, { unique: true });

export default mongoose.models.DauDayUser ||
  mongoose.model("DauDayUser", dauDayUserSchema);
