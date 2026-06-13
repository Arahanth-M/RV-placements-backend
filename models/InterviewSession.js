import mongoose from "mongoose";

const ROUND_TYPES = ["DSA", "System Design", "SQL", "CS Fundamentals", "HR"];
const ROUND_STATE = ["IN_PROGRESS", "COMPLETED"];
const INTERVIEW_STATE = ["IN_PROGRESS", "COMPLETED"];
const INTERVIEW_STATES = [
  "PREVIEW",
  "IN_PROGRESS",
  "ROUND_ACTIVE",
  "EVALUATING",
  "ROUND_COMPLETE",
  "INTERVIEW_COMPLETE",
];

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

const expectedPointSchema = new mongoose.Schema(
  {
    text: { type: String, trim: true },
    category: { type: String, trim: true, default: "coverage" },
    importance: {
      type: String,
      enum: ["mustHave", "goodToHave", "redFlag"],
      default: "mustHave",
    },
    expectedAnswerMode: {
      type: String,
      enum: ["code", "design", "story", "conceptual", "mcq"],
      default: "conceptual",
    },
    embedding: { type: [Number] },
  },
  { _id: false }
);

const codeExecutionTraceSchema = new mongoose.Schema(
  {
    status: { type: String, trim: true },
    passedCount: { type: Number },
    failedCount: { type: Number },
    totalCount: { type: Number },
    visiblePassedCount: { type: Number },
    visibleTotalCount: { type: Number },
    hiddenPassedCount: { type: Number },
    hiddenTotalCount: { type: Number },
    executionTime: { type: Number },
    weightedPassRate: { type: Number },
    failedTests: { type: [mongoose.Schema.Types.Mixed], default: [] },
    /** Per hidden case pass/fail; failure rows include input/expected/actual for post-submit UI. */
    hiddenTestResults: { type: [mongoose.Schema.Types.Mixed], default: [] },
    /** Lightweight pass/fail rows (legacy fallback for hidden results). */
    caseResults: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    userDebugOutput: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const mcqEvaluationTraceSchema = new mongoose.Schema(
  {
    selectedOptionId: { type: String, trim: true },
    correctOptionId: { type: String, trim: true },
    selectedOptionText: { type: String, trim: true },
    correctOptionText: { type: String, trim: true },
    reason: { type: String, trim: true },
    explanation: { type: String, trim: true },
  },
  { _id: false }
);

const evaluationTraceSchema = new mongoose.Schema(
  {
    scoringVersion: { type: String, trim: true },
    questionType: { type: String, trim: true },
    expectedAnswerMode: { type: String, trim: true },
    verdict: {
      type: String,
      enum: ["correct", "partial", "incorrect"],
    },
    confidence: { type: Number },
    relevance: { type: Number },
    coverage: { type: Number },
    correctness: { type: Number },
    communication: { type: Number },
    matchedRubricPoints: { type: [String], default: [] },
    missingRubricPoints: { type: [String], default: [] },
    criticalMisses: { type: [String], default: [] },
    subscores: {
      type: Map,
      of: Number,
      default: {},
    },
    execution: {
      type: codeExecutionTraceSchema,
      default: undefined,
    },
    mcq: {
      type: mcqEvaluationTraceSchema,
      default: undefined,
    },
  },
  { _id: false }
);

const roundAnswerAttemptSchema = new mongoose.Schema(
  {
    answer: { type: String, trim: true },
    score: { type: Number },
    feedback: { type: String, trim: true },
    evaluationTrace: {
      type: evaluationTraceSchema,
      default: null,
    },
  },
  { _id: false }
);

const roundQuestionSchema = new mongoose.Schema(
  {
    question: { type: String, trim: true },
    questionId: { type: String, trim: true },
    /** Canonical reference link (e.g. LeetCode problem URL). */
    questionUrl: { type: String, trim: true, default: "" },
    /** For code_execution rounds: languages the sandbox may run (e.g. python, cpp, java). */
    supportedCodingLanguages: { type: [String], default: undefined },
    evaluationStrategy: { type: String, trim: true },
    sourceType: {
      type: String,
      enum: ["retrieved", "generated"],
    },
    previewRunCount: { type: Number, default: 0, min: 0 },
    answer: { type: String, trim: true },
    score: { type: Number },
    feedback: { type: String, trim: true },
    evaluationTrace: {
      type: evaluationTraceSchema,
      default: null,
    },
    /** Initial submission plus at most one reattempt per question (worker-enforced). */
    attempts: {
      type: [roundAnswerAttemptSchema],
      default: [],
    },
    expectedPoints: {
      type: [expectedPointSchema],
      default: [],
    },
    /** Snapshot from bank at question creation — grading prefers this over a second DB lookup. */
    resolvedCodeTestCases: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    resolvedDsaMetadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
    /** Display metadata snapshotted at pick time (avoids bank lookups on status polls). */
    resolvedTopics: { type: [String], default: undefined },
    resolvedSubtopics: { type: [String], default: undefined },
    resolvedCompanyTags: { type: [String], default: undefined },
    resolvedComplexity: { type: mongoose.Schema.Types.Mixed, default: undefined },
    /** MCQ grading key + options — never expose correctOptionId to clients. */
    resolvedMcqMetadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
    expectedAnswerMode: {
      type: String,
      enum: ["code", "design", "story", "conceptual", "mcq"],
      default: "conceptual",
    },
  },
  { _id: false }
);

const roundDsaStatsSchema = new mongoose.Schema(
  {
    totalQuestions: { type: Number, default: 0 },
    answeredCorrectly: { type: Number, default: 0 },
    partiallyAnswered: { type: Number, default: 0 },
    notAnswered: { type: Number, default: 0 },
  },
  { _id: false }
);

const roundFeedbackSchema = new mongoose.Schema(
  {
    summary: { type: String, trim: true },
    strengths: { type: [String], default: [] },
    weaknesses: { type: [String], default: [] },
    improvementTips: { type: [String], default: [] },
    /** Populated for DSA / code-execution rounds only — deterministic counts, no LLM. */
    dsaRoundStats: { type: roundDsaStatsSchema, default: undefined },
    /** Union of round focus + bank topics/subtopics for DSA-style rounds. */
    topicsCoveredThisRound: { type: [String], default: undefined },
    /** Average score for the round (merged by worker after feedback generation). */
    score: { type: Number },
  },
  { _id: false }
);

const roundSchema = new mongoose.Schema(
  {
    roundNumber: { type: Number, required: true, min: 1 },
    type: { type: String, enum: ROUND_TYPES, required: true },
    about: { type: String, trim: true },
    difficulty: { type: String, trim: true },
  /** Per-round cap from {@link inferQuestionCount}; HR allows 1, DSA up to 2, SQL up to 4, others up to 5. */
    questionCount: { type: Number, min: 1, max: 5, default: 3 },
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
      ref: "CompanyStatic",
    },
    /** Normalized `company_visits.type` for this mock (empty string = default slot). */
    placementVisitType: {
      type: String,
      trim: true,
      default: "",
    },
    /** Normalized `company_visits.cluster` for this mock (empty string = default slot). */
    placementCluster: {
      type: String,
      trim: true,
      default: "",
    },
    /** Placement year for `company_visits` row (matches `year` field). */
    placementYear: {
      type: Number,
      default: 2026,
      min: 2000,
      max: 2100,
    },
    /** When true, interview material merges all approved visits sharing {@link placementVisitType} (any year/cluster). */
    mergePlacementByType: {
      type: Boolean,
      default: false,
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
    state: {
      type: String,
      enum: INTERVIEW_STATES,
      default: "PREVIEW",
    },
    // LEGACY FIELDS (status, interviewStatus)
    // TODO: remove after full migration
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
      /** 0–100 readiness for this company (derived from performance + verdict). */
      readinessScore: { type: Number, min: 0, max: 100 },
      /** Human label: Ready | Needs improvement | Not ready */
      readinessLabel: { type: String, trim: true },
      /** LLM verdict slug: ready | needs_improvement | not_ready */
      verdict: { type: String, trim: true },
      strengths: [{ type: String }],
      weaknesses: [{ type: String }],
      improvementPlan: [{ type: String }],
      overallStrength: { type: String, trim: true },
      overallWeakness: { type: String, trim: true },
      summaryFeedback: { type: String, trim: true },
      companyRoadmap: [{ type: String, trim: true }],
    },
  },
  { timestamps: true }
);

interviewSessionSchema.index({ userId: 1, state: 1, updatedAt: 1 });

/**
 * Canonical state is `state`.
 * Legacy fields are mirrored for compatibility while callers migrate.
 */
interviewSessionSchema.pre("validate", function syncLegacyStates(next) {
  // If state is present, mirror into legacy fields.
  if (typeof this.state === "string" && this.state.trim()) {
    const isCompleted = this.state === "INTERVIEW_COMPLETE";
    this.interviewStatus = isCompleted ? "COMPLETED" : "IN_PROGRESS";
    this.status = isCompleted ? "completed" : "in_progress";
    this.roundStatus = this.state === "ROUND_COMPLETE" ? "COMPLETED" : "IN_PROGRESS";
    return next();
  }

  // Fallback inference for older documents that may not have `state`.
  if (this.status === "completed" || this.interviewStatus === "COMPLETED") {
    this.state = "INTERVIEW_COMPLETE";
    return next();
  }

  if (this.roundStatus === "COMPLETED") {
    this.state = "ROUND_COMPLETE";
    return next();
  }

  this.state = this.currentQuestion ? "ROUND_ACTIVE" : "IN_PROGRESS";
  return next();
});

const InterviewSession = mongoose.model("InterviewSession", interviewSessionSchema);

export default InterviewSession;
