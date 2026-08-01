import mongoose from "mongoose";

const campusEvidenceSchema = new mongoose.Schema(
  {
    sourceType: {
      type: String,
      enum: ["must_do", "oa", "interview_question", "interview_experience"],
      default: "must_do",
    },
    snippet: { type: String, trim: true },
    year: { type: Number, default: null },
    cluster: { type: String, trim: true, default: "" },
    branch: { type: String, trim: true, default: "" },
    label: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const roadmapTaskSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    minutes: { type: Number, min: 0 },
    resourceHint: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const roadmapDaySchema = new mongoose.Schema(
  {
    day: { type: Number, min: 1 },
    hours: { type: Number, min: 0 },
    focus: { type: String, trim: true },
    tasks: [roadmapTaskSchema],
    campusEvidence: [campusEvidenceSchema],
  },
  { _id: false }
);

const topicSubtopicSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    hours: { type: Number, min: 0 },
    notes: { type: String, trim: true },
    /** Optional learning resource for this subtopic */
    linkTitle: { type: String, trim: true },
    linkUrl: { type: String, trim: true },
    linkWhy: { type: String, trim: true },
  },
  { _id: false }
);

const topicSectionSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    hours: { type: Number, min: 0 },
    why: { type: String, trim: true },
    practiceHints: [{ type: String, trim: true }],
    subtopics: [topicSubtopicSchema],
    campusEvidence: [campusEvidenceSchema],
  },
  { _id: false }
);

const companySignalSchema = new mongoose.Schema(
  {
    point: { type: String, trim: true },
    sourceType: {
      type: String,
      enum: ["must_do", "oa", "interview_question", "interview_experience"],
      default: "must_do",
    },
    year: { type: Number, default: null },
    cluster: { type: String, trim: true, default: "" },
    branch: { type: String, trim: true, default: "" },
    label: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const studyLinkSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    url: { type: String, trim: true },
    why: { type: String, trim: true },
  },
  { _id: false }
);

const sourceSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    url: { type: String, trim: true },
    kind: { type: String, enum: ["platform", "web"], default: "platform" },
  },
  { _id: false }
);

/**
 * PrepPath — personal company interview prep roadmaps.
 * Additive collection only; never writes to company/user/placement collections.
 */
const prepPathPlanSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyStatic",
      required: true,
      index: true,
    },
    companyName: { type: String, trim: true, default: "" },
    role: { type: String, trim: true, required: true },
    /** Prep target track — drives visit filtering + LLM framing. */
    track: {
      type: String,
      enum: ["full_time", "summer_internship"],
      required: true,
      default: "full_time",
      index: true,
    },
    days: { type: Number, required: true, min: 1, max: 5 },
    hoursPerDay: { type: Number, required: true, min: 0.5, max: 16 },
    resumeMeta: {
      fileName: { type: String, trim: true, default: "" },
      mime: { type: String, trim: true, default: "" },
      textChars: { type: Number, default: 0 },
    },
    resumeDigest: { type: String, trim: true, maxlength: 4000, default: "" },
    contextFlags: {
      usedMustDo: { type: Boolean, default: false },
      usedOA: { type: Boolean, default: false },
      usedInterview: { type: Boolean, default: false },
      usedExperiences: { type: Boolean, default: false },
      webAugmented: { type: Boolean, default: false },
      limitedData: { type: Boolean, default: false },
    },
    /** Snapshot of peer PrepPath demand for this company (last 7 IST days). */
    peerDemand: {
      windowDays: { type: Number, default: 7 },
      uniqueStudents: { type: Number, default: 0 },
      planCount: { type: Number, default: 0 },
      label: { type: String, trim: true, default: "" },
      hot: { type: Boolean, default: false },
      since: { type: String, trim: true, default: "" },
    },
    roadmap: {
      summary: { type: String, trim: true, default: "" },
      totalHours: { type: Number, default: 0 },
      assumptions: [{ type: String, trim: true }],
      /** Resume strengths relevant to this company/role */
      resumeStrengths: [{ type: String, trim: true }],
      /** What the resume is missing for this company/role */
      resumeMissing: [{ type: String, trim: true }],
      /** What the company likely expects most from candidates */
      companyExpectations: [{ type: String, trim: true }],
      skillGaps: [{ type: String, trim: true }],
      /** Grounded highlights from must-do / OA / interview Qs / experiences when data exists */
      companySignals: [companySignalSchema],
      topicSections: [topicSectionSchema],
      days: [roadmapDaySchema],
      studyLinks: [studyLinkSchema],
      motivationSlogans: [{ type: String, trim: true }],
      dataQualityNote: { type: String, trim: true, default: "" },
    },
    sources: [sourceSchema],
  },
  { timestamps: true }
);

prepPathPlanSchema.index({ userId: 1, createdAt: -1 });
prepPathPlanSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.models.PrepPathPlan ||
  mongoose.model("PrepPathPlan", prepPathPlanSchema, "prep_path_plans");
