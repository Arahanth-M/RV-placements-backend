import mongoose from "mongoose";

const challengeProblemSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    points: { type: Number, min: 0, default: 100 },
    topics: { type: [String], default: [] },
  },
  { _id: false }
);

const practiceChallengeSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      required: true,
      enum: ["daily", "weekly"],
      index: true,
    },
    /** IST day YYYY-MM-DD or ISO week YYYY-Www */
    periodKey: { type: String, required: true, trim: true, index: true },
    opensAt: { type: Date, required: true },
    closesAt: { type: Date, required: true },
    problems: {
      type: [challengeProblemSchema],
      default: [],
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length >= 1 && v.length <= 5;
        },
        message: "Challenge must have 1–5 problems",
      },
    },
    status: {
      type: String,
      enum: ["scheduled", "active", "closed"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

practiceChallengeSchema.index({ kind: 1, periodKey: 1 }, { unique: true });
practiceChallengeSchema.index({ status: 1, opensAt: 1, closesAt: 1 });

export default mongoose.models.PracticeChallenge ||
  mongoose.model("PracticeChallenge", practiceChallengeSchema, "practice_challenges");
