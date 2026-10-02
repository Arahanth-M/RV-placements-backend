import mongoose from "mongoose";

const userPracticeStatsSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, unique: true, index: true },
    displayName: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    pointsTotal: { type: Number, min: 0, default: 0, index: true },
    dailyPoints: { type: Number, min: 0, default: 0 },
    weeklyPoints: { type: Number, min: 0, default: 0 },
    /** Which IST day/week the dailyPoints / weeklyPoints counters refer to */
    dailyPeriodKey: { type: String, trim: true, default: "" },
    weeklyPeriodKey: { type: String, trim: true, default: "" },
    solvesTotal: { type: Number, min: 0, default: 0 },
    currentStreak: { type: Number, min: 0, default: 0 },
    longestStreak: { type: Number, min: 0, default: 0 },
    lastSolveDayKey: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

userPracticeStatsSchema.index({ pointsTotal: -1 });
userPracticeStatsSchema.index({ dailyPoints: -1, dailyPeriodKey: 1 });
userPracticeStatsSchema.index({ weeklyPoints: -1, weeklyPeriodKey: 1 });

export default mongoose.models.UserPracticeStats ||
  mongoose.model("UserPracticeStats", userPracticeStatsSchema, "user_practice_stats");
