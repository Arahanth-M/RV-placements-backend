import mongoose from "mongoose";

const historyItemSchema = new mongoose.Schema(
  {
    question: { type: String },
    answer: { type: String },
    score: { type: Number },
    feedback: { type: String },
    round: { type: String },
    difficulty: { type: String },
  },
  { _id: false }
);

const interviewSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
    },
    role: {
      type: String,
    },
    history: {
      type: [historyItemSchema],
      default: [],
    },
    currentRound: {
      type: String,
    },
    roundsPlan: {
      type: [String],
      default: [],
    },
    roundsDetails: {
      type: [
        {
          round: { type: String },
          questionType: { type: String },
        },
      ],
      default: [],
    },
    totalRounds: {
      type: Number,
      default: 0,
    },
    currentRoundIndex: {
      type: Number,
      default: 0,
    },
    difficultyLevel: {
      type: String,
    },
    currentQuestion: {
      type: String,
    },
    status: {
      type: String,
      enum: ["in_progress", "completed"],
      default: "in_progress",
    },
    finalReport: {
      overallScore: { type: Number },
      strengths: [{ type: String }],
      weaknesses: [{ type: String }],
      improvementPlan: [{ type: String }],
    },
  },
  { timestamps: true }
);

const InterviewSession = mongoose.model("InterviewSession", interviewSessionSchema);

export default InterviewSession;
