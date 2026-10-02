import mongoose from "mongoose";

const starDimSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true },
    label: { type: String, trim: true },
    score: { type: Number, min: 0, max: 100 },
    tip: { type: String, trim: true, default: "" },
    weak: { type: Boolean, default: false },
  },
  { _id: false }
);

const behavioralCoachAttemptSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    practiceId: { type: String, required: true, trim: true },
    focus: {
      type: String,
      trim: true,
      lowercase: true,
      enum: ["general", "teamwork", "conflict", "leadership", "failure", "why_company"],
      default: "general",
    },
    question: { type: String, required: true, trim: true, maxlength: 2000 },
    answer: { type: String, trim: true, maxlength: 12000, default: "" },
    score: { type: Number, min: 0, max: 10, required: true },
    feedback: { type: String, trim: true, maxlength: 8000, default: "" },
    verdict: { type: String, trim: true, maxlength: 120, default: "" },
    starBreakdown: { type: [starDimSchema], default: [] },
    coachingHints: { type: [String], default: [] },
    matchedRubricPoints: { type: [String], default: [] },
    missingRubricPoints: { type: [String], default: [] },
  },
  { timestamps: true }
);

behavioralCoachAttemptSchema.index({ userId: 1, createdAt: -1 });
behavioralCoachAttemptSchema.index({ userId: 1, focus: 1, createdAt: -1 });

export default mongoose.models.BehavioralCoachAttempt ||
  mongoose.model(
    "BehavioralCoachAttempt",
    behavioralCoachAttemptSchema,
    "behavioral_coach_attempts"
  );
