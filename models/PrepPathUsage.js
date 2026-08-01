import mongoose from "mongoose";

/**
 * Daily PrepPath generate counters (IST calendar day).
 * Additive only — increments new docs / updates this collection only.
 */
const prepPathUsageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true },
    /** `YYYY-MM-DD` in Asia/Kolkata */
    dayKey: { type: String, required: true, trim: true },
    count: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

prepPathUsageSchema.index({ userId: 1, dayKey: 1 }, { unique: true });

export default mongoose.models.PrepPathUsage ||
  mongoose.model("PrepPathUsage", prepPathUsageSchema, "prep_path_usage");
