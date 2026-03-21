import mongoose from "mongoose";

const ROUND_TYPES = ["DSA", "System Design", "HR"];
const ROUND_STATE = ["IN_PROGRESS", "COMPLETED"];
const INTERVIEW_STATE = ["IN_PROGRESS", "COMPLETED"];

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

const roundQuestionSchema = new mongoose.Schema(
  {
    question: { type: String, trim: true },
    answer: { type: String, trim: true },
    score: { type: Number },
    feedback: { type: String, trim: true },
  },
  { _id: false }
);

const roundFeedbackSchema = new mongoose.Schema(
  {
    summary: { type: String, trim: true },
    strengths: { type: [String], default: [] },
    weaknesses: { type: [String], default: [] },
    improvementTips: { type: [String], default: [] },
  },
  { _id: false }
);

const roundSchema = new mongoose.Schema(
  {
    roundNumber: { type: Number, required: true, min: 1 },
    type: { type: String, enum: ROUND_TYPES, required: true },
    difficulty: { type: String, trim: true },
    questionCount: { type: Number, min: 3, max: 5, default: 3 },
    questions: { type: [roundQuestionSchema], default: [] },
    feedback: { type: roundFeedbackSchema, default: () => ({}) },
    status: {
      type: String,
      enum: ROUND_STATE,
      default: "IN_PROGRESS",
    },
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
      type: Number,
      default: 1,
      min: 1,
    },
    currentQuestionIndex: {
      type: Number,
      default: 0,
      min: 0,
    },
    roundStatus: {
      type: String,
      enum: ROUND_STATE,
      default: "IN_PROGRESS",
    },
    interviewStatus: {
      type: String,
      enum: INTERVIEW_STATE,
      default: "IN_PROGRESS",
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
      default: 1,
      min: 1,
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
    rounds: {
      type: [roundSchema],
      default: [],
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
