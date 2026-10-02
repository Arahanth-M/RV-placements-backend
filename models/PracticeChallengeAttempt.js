import mongoose from "mongoose";

const practiceChallengeAttemptSchema = new mongoose.Schema(
  {
    challengeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PracticeChallenge",
      required: true,
      index: true,
    },
    questionId: { type: String, required: true, trim: true, index: true },
    userId: { type: String, required: true, trim: true, index: true },
    language: { type: String, trim: true, default: "python" },
    code: { type: String, default: "" },
    score: { type: Number, min: 0, max: 100, default: 0 },
    weightedPassRate: { type: Number, min: 0, max: 1, default: 0 },
    passedVisible: { type: Number, min: 0, default: 0 },
    passedHidden: { type: Number, min: 0, default: 0 },
    totalVisible: { type: Number, min: 0, default: 0 },
    totalHidden: { type: Number, min: 0, default: 0 },
    status: {
      type: String,
      enum: ["started", "submitted"],
      default: "submitted",
    },
    timeMs: { type: Number, min: 0, default: 0 },
    executionStatus: { type: String, trim: true, default: "" },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

/** One best attempt row per user per problem on a challenge (upsert highest score). */
practiceChallengeAttemptSchema.index(
  { challengeId: 1, questionId: 1, userId: 1 },
  { unique: true }
);
practiceChallengeAttemptSchema.index({ userId: 1, submittedAt: -1 });
practiceChallengeAttemptSchema.index({ challengeId: 1, score: -1 });

export default mongoose.models.PracticeChallengeAttempt ||
  mongoose.model(
    "PracticeChallengeAttempt",
    practiceChallengeAttemptSchema,
    "practice_challenge_attempts"
  );
