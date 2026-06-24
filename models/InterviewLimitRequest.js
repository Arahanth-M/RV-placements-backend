import mongoose from "mongoose";

const INTERVIEW_LIMIT_REQUEST_STATUS = ["pending", "approved", "dismissed"];

const interviewLimitRequestSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    status: {
      type: String,
      enum: INTERVIEW_LIMIT_REQUEST_STATUS,
      default: "pending",
    },
    nextAvailableAt: { type: Date },
    lastCompletedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedByEmail: { type: String, trim: true, lowercase: true },
  },
  { timestamps: true }
);

interviewLimitRequestSchema.index({ userId: 1, status: 1 });
interviewLimitRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("InterviewLimitRequest", interviewLimitRequestSchema);
