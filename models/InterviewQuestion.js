import mongoose from "mongoose";

const ROUND_TYPES = ["DSA", "SQL", "System Design", "HR", "CS Fundamentals"];
const DIFFICULTY_LEVELS = ["easy", "medium", "hard"];
const EVALUATION_STRATEGIES = [
  "code_execution",
  "sql_execution",
  "rubric_llm",
  "behavioral_llm",
  "mcq_exact",
];
const IMPORTANCE_LEVELS = ["mustHave", "goodToHave", "redFlag"];
const ANSWER_MODES = ["code", "design", "story", "conceptual", "mcq"];

const testcaseSchema = new mongoose.Schema(
  {
    input: { type: mongoose.Schema.Types.Mixed, required: true },
    expectedOutput: { type: mongoose.Schema.Types.Mixed, required: true },
    isHidden: { type: Boolean, default: false },
    weight: { type: Number, min: 0, default: 1 },
  },
  { _id: false }
);

const rubricItemSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: "coverage" },
    importance: {
      type: String,
      enum: IMPORTANCE_LEVELS,
      default: "mustHave",
    },
    expectedAnswerMode: {
      type: String,
      enum: ANSWER_MODES,
      default: "conceptual",
    },
  },
  { _id: false }
);

const complexitySchema = new mongoose.Schema(
  {
    time: { type: String, trim: true, default: "" },
    space: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const sqlMetadataSchema = new mongoose.Schema(
  {
    databaseSchema: { type: String, trim: true, default: "" },
    seedData: { type: mongoose.Schema.Types.Mixed, default: null },
    expectedResult: { type: mongoose.Schema.Types.Mixed, default: null },
    validationRules: { type: [String], default: [] },
  },
  { _id: false }
);

const dsaMetadataSchema = new mongoose.Schema(
  {
    supportedLanguages: { type: [String], default: [] },
    starterCode: { type: mongoose.Schema.Types.Mixed, default: null },
    functionSignature: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const systemDesignMetadataSchema = new mongoose.Schema(
  {
    requiredConcepts: { type: [String], default: [] },
  },
  { _id: false }
);

const hrMetadataSchema = new mongoose.Schema(
  {
    behavioralSignals: { type: [String], default: [] },
  },
  { _id: false }
);

const analyticsMetadataSchema = new mongoose.Schema(
  {
    timesUsed: { type: Number, min: 0, default: 0 },
    successRate: { type: Number, min: 0, max: 1, default: 0 },
    averageScore: { type: Number, min: 0, max: 10, default: 0 },
    averageCompletionTime: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const sourceMetadataSchema = new mongoose.Schema(
  {
    source: { type: String, trim: true, default: "curated" },
    verified: { type: Boolean, default: false },
    qualityScore: { type: Number, min: 0, max: 1, default: 0.5 },
  },
  { _id: false }
);

const interviewQuestionSchema = new mongoose.Schema(
  {
    // Core identity
    questionId: { type: String, required: true, trim: true, unique: true },
    title: { type: String, required: true, trim: true },
    question: { type: String, required: true, trim: true },
    /** Optional canonical link (e.g. LeetCode problem page). Distinct from sourceMetadata.source labels. */
    url: { type: String, trim: true, default: "" },

    // Classification
    companyTags: { type: [String], default: [] },
    roundType: { type: String, enum: ROUND_TYPES, required: true },
    difficulty: { type: String, enum: DIFFICULTY_LEVELS, required: true },
    topics: { type: [String], default: [] },
    subtopics: { type: [String], default: [] },

    // Evaluation strategy
    evaluationStrategy: {
      type: String,
      enum: EVALUATION_STRATEGIES,
      required: true,
    },

    // DSA metadata
    dsaMetadata: { type: dsaMetadataSchema, default: () => ({}) },

    // Test cases
    testCases: { type: [testcaseSchema], default: [] },

    // Rubric metadata (compatible with expectedPoints[] in evaluateAnswer.js)
    rubric: { type: [rubricItemSchema], default: [] },

    // Complexity expectations
    complexity: { type: complexitySchema, default: () => ({}) },

    // SQL metadata
    sqlMetadata: { type: sqlMetadataSchema, default: () => ({}) },

    // System design metadata
    systemDesignMetadata: {
      type: systemDesignMetadataSchema,
      default: () => ({}),
    },

    // HR metadata
    hrMetadata: { type: hrMetadataSchema, default: () => ({}) },

    // Analytics metadata
    analytics: { type: analyticsMetadataSchema, default: () => ({}) },

    // Source metadata
    sourceMetadata: { type: sourceMetadataSchema, default: () => ({}) },
  },
  { timestamps: true }
);

interviewQuestionSchema.path("testCases").validate(function validateTestCases(value) {
  if (this.evaluationStrategy !== "code_execution") return true;
  if (!Array.isArray(value) || value.length === 0) return false;
  const visible = value.filter((tc) => tc && tc.isHidden !== true);
  const hidden = value.filter((tc) => tc && tc.isHidden === true);
  return visible.length >= 2 && hidden.length >= 2;
}, "code_execution requires testCases: at least two visible (isHidden: false) and two hidden (isHidden: true).");

interviewQuestionSchema.index({ companyTags: 1 });
interviewQuestionSchema.index({ roundType: 1 });
interviewQuestionSchema.index({ difficulty: 1 });
interviewQuestionSchema.index({ topics: 1 });
interviewQuestionSchema.index({ questionId: 1 }, { unique: true });

const InterviewQuestion = mongoose.model("InterviewQuestion", interviewQuestionSchema);

export default InterviewQuestion;
