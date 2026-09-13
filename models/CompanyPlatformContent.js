import mongoose from "mongoose";

const submittedBySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const reviewedBySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const codingSolutionsSchema = new mongoose.Schema(
  {
    cpp: { type: String, trim: true, default: "" },
    java: { type: String, trim: true, default: "" },
    python: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const questionItemSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["coding", "non_coding"],
      default: "non_coding",
    },
    question: { type: String, trim: true, default: "" },
    answer: { type: String, trim: true, default: "" },
    solutions: { type: codingSolutionsSchema, default: undefined },
    intuition: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved"],
      default: "approved",
    },
    isAnonymous: { type: Boolean, default: false },
    submittedBy: { type: submittedBySchema, default: undefined },
    reviewedBy: { type: reviewedBySchema, default: undefined },
    createdAt: { type: Date, default: undefined },
    approvedAt: { type: Date, default: undefined },
  },
  { _id: true }
);

const experienceItemSchema = new mongoose.Schema(
  {
    content: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved"],
      default: "approved",
    },
    isAnonymous: { type: Boolean, default: false },
    submittedBy: { type: submittedBySchema, default: undefined },
    reviewedBy: { type: reviewedBySchema, default: undefined },
    createdAt: { type: Date, default: undefined },
    approvedAt: { type: Date, default: undefined },
  },
  { _id: true }
);

const mustDoItemSchema = new mongoose.Schema(
  {
    topic: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved"],
      default: "approved",
    },
    submittedBy: { type: submittedBySchema, default: undefined },
    createdAt: { type: Date, default: undefined },
    approvedAt: { type: Date, default: undefined },
  },
  { _id: true }
);

const codingQuestionItemSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.Mixed, default: null },
    solutions: { type: codingSolutionsSchema, default: undefined },
    intuition: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved"],
      default: "approved",
    },
    submittedBy: { type: submittedBySchema, default: undefined },
    createdAt: { type: Date, default: undefined },
    approvedAt: { type: Date, default: undefined },
  },
  { _id: true }
);

const companyPlatformContentSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyStatic",
      required: true,
    },
    onlineQuestions: { type: [questionItemSchema], default: [] },
    interviewQuestions: { type: [questionItemSchema], default: [] },
    interviewExperiences: { type: [experienceItemSchema], default: [] },
    internshipExperiences: { type: [experienceItemSchema], default: [] },
    mustDoTopics: { type: [mustDoItemSchema], default: [] },
    codingQuestions: { type: [codingQuestionItemSchema], default: [] },
    mcqQuestions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

companyPlatformContentSchema.index({ companyId: 1 }, { unique: true });

const CompanyPlatformContent = mongoose.model(
  "CompanyPlatformContent",
  companyPlatformContentSchema,
  "company_platform_content"
);

export default CompanyPlatformContent;
