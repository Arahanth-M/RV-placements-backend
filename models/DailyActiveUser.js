import mongoose from "mongoose";

/**
 * Immutable-ish daily DAU snapshots (new collection only).
 * Does not modify users1 or any other existing collections.
 */
const dauUserSchema = new mongoose.Schema(
  {
    userId: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, default: "" },
    username: { type: String, trim: true, default: "" },
    role: { type: String, trim: true, default: "" },
    lastLoginAt: { type: Date, default: null },
  },
  { _id: false }
);

const dailyActiveUserSchema = new mongoose.Schema(
  {
    /** Calendar day key YYYY-MM-DD (UTC, matches admin DAU aggregation). */
    dayKey: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    count: { type: Number, default: 0, min: 0 },
    users: { type: [dauUserSchema], default: [] },
    capturedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "daily_active_users",
  }
);

export default mongoose.models.DailyActiveUser ||
  mongoose.model("DailyActiveUser", dailyActiveUserSchema);
