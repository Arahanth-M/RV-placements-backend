import Joi from "joi";
import {
  INTERVIEW_DIFFICULTIES,
  PLATFORM_FRESHER_ROLES,
  PLATFORM_INTERVIEW_ROUND_TYPES,
} from "../config/interviewCatalog.js";

const stringList = Joi.array().items(Joi.string().trim().min(1).max(160)).max(100);

const rubricItem = Joi.object({
  text: Joi.string().trim().min(2).max(1000).required(),
  category: Joi.string().trim().max(80).default("coverage"),
  importance: Joi.string().valid("mustHave", "goodToHave", "redFlag").default("mustHave"),
  expectedAnswerMode: Joi.string()
    .valid("code", "design", "story", "conceptual", "mcq")
    .default("conceptual"),
});

const testCase = Joi.object({
  input: Joi.any().required(),
  expectedOutput: Joi.any().required(),
  isHidden: Joi.boolean().default(false),
  weight: Joi.number().min(0).default(1),
});

const mcqOption = Joi.object({
  id: Joi.string().trim().uppercase().valid("A", "B", "C", "D", "E", "F").required(),
  text: Joi.string().trim().min(1).max(1000).required(),
  distractorReason: Joi.string().trim().allow("").max(1000).default(""),
});

export const interviewQuestionBankWriteSchema = Joi.object({
  questionId: Joi.string().trim().min(2).max(120).pattern(/^[a-zA-Z0-9._:-]+$/).required(),
  title: Joi.string().trim().min(2).max(300).required(),
  question: Joi.string().trim().min(5).max(20000).required(),
  url: Joi.string().trim().allow("").uri({ allowRelative: false }).max(2000).default(""),
  companyTags: stringList.required(),
  roleTags: Joi.array()
    .items(Joi.string().valid(...PLATFORM_FRESHER_ROLES))
    .min(1)
    .max(PLATFORM_FRESHER_ROLES.length)
    .unique()
    .required(),
  roundType: Joi.string()
    .valid(...PLATFORM_INTERVIEW_ROUND_TYPES)
    .required(),
  difficulty: Joi.string()
    .valid(...INTERVIEW_DIFFICULTIES)
    .required(),
  topics: stringList.default([]),
  subtopics: stringList.default([]),
  evaluationStrategy: Joi.string()
    .valid("code_execution", "sql_execution", "rubric_llm", "behavioral_llm", "mcq_exact")
    .required(),
  dsaMetadata: Joi.object({
    supportedLanguages: stringList.default([]),
    starterCode: Joi.any().allow(null).default(null),
    functionSignature: Joi.string().trim().allow("").max(500).default(""),
  }).default({}),
  testCases: Joi.array().items(testCase).max(100).default([]),
  rubric: Joi.array().items(rubricItem).max(30).default([]),
  complexity: Joi.object({
    time: Joi.string().trim().allow("").max(120).default(""),
    space: Joi.string().trim().allow("").max(120).default(""),
  }).default({}),
  sqlMetadata: Joi.object({
    databaseSchema: Joi.string().allow("").max(30000).default(""),
    seedData: Joi.any().allow(null).default(null),
    expectedResult: Joi.any().allow(null).default(null),
    validationRules: stringList.default([]),
  }).default({}),
  systemDesignMetadata: Joi.object({
    requiredConcepts: stringList.default([]),
  }).default({}),
  hrMetadata: Joi.object({
    behavioralSignals: stringList.default([]),
  }).default({}),
  mcqMetadata: Joi.object({
    options: Joi.array().items(mcqOption).max(6).default([]),
    correctOptionId: Joi.string()
      .trim()
      .uppercase()
      .allow("")
      .valid("", "A", "B", "C", "D", "E", "F")
      .default(""),
    allowMultiple: Joi.boolean().default(false),
    shuffleOptions: Joi.boolean().default(true),
    explanation: Joi.string().trim().allow("").max(5000).default(""),
    explanationRequired: Joi.boolean().default(false),
    selectionWeight: Joi.number().min(0).default(1),
    explanationWeight: Joi.number().min(0).default(0),
  }).default({}),
  sourceMetadata: Joi.object({
    source: Joi.string().trim().min(1).max(160).default("curated"),
    verified: Joi.boolean().default(false),
    qualityScore: Joi.number().min(0).max(1).default(0.5),
  }).default({}),
});

export const interviewQuestionBankBulkSchema = Joi.object({
  ids: Joi.array().items(Joi.string().hex().length(24)).min(1).max(200).unique().required(),
  operation: Joi.string().valid("add", "remove", "replace").required(),
  field: Joi.string().valid("companyTags", "roleTags").required(),
  values: stringList.min(1).required(),
});

export const validateQuestionStrategy = (question) => {
  const strategy = String(question?.evaluationStrategy || "");
  if (strategy === "code_execution") {
    const visible = (question.testCases || []).filter((item) => item?.isHidden !== true);
    const hidden = (question.testCases || []).filter((item) => item?.isHidden === true);
    if (!question?.dsaMetadata?.functionSignature || visible.length < 2 || hidden.length < 2) {
      return "Code-execution questions require a function signature, two visible tests, and two hidden tests.";
    }
  }
  if (strategy === "mcq_exact") {
    const options = question?.mcqMetadata?.options || [];
    const correct = String(question?.mcqMetadata?.correctOptionId || "");
    if (options.length < 2 || !options.some((option) => option.id === correct)) {
      return "MCQ questions require at least two options and a matching correct option.";
    }
  }
  if (
    (strategy === "rubric_llm" || strategy === "behavioral_llm") &&
    (!Array.isArray(question?.rubric) || question.rubric.length === 0)
  ) {
    return "Rubric-based questions require at least one rubric item.";
  }
  return "";
};
