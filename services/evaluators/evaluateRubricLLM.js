import { getEmbedding, cosineSimilarity } from "../../utils/embedding.js";
import { GROQ_QUALITY_MODEL } from "../../config/groqModels.js";
import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";
import { logInterviewDsaLlmDebug } from "../interviewDebugLog.js";
import {
  applyLlmGeneratedDeterministicOverrides,
  applyLlmGeneratedVerdictAndFactualityCaps,
  clampLlmSubscoresForGenerated,
  deriveStrictVerdictForGenerated,
  isLlmGeneratedQuestionSource,
  LLM_GENERATED_EMPTY_MUST_HAVE_COVERAGE,
} from "./llmGeneratedQuestionScoring.js";

const TOOL_EVAL_MODEL = process.env.GROQ_TOOL_MODEL || GROQ_QUALITY_MODEL;
const LLM_GENERATED_GRADING_MODEL =
  process.env.GROQ_GENERATED_GRADING_MODEL || process.env.GROQ_TOOL_MODEL || GROQ_QUALITY_MODEL;
const SCORING_VERSION = "v3-rubric-strict";
const RUBRIC_MATCH_THRESHOLD = 0.72;
const RUBRIC_PARTIAL_THRESHOLD = 0.55;
const MAX_PROMPT_ANSWER_CHARS = Number(process.env.EVAL_PROMPT_ANSWER_CHARS || 1400);
const MAX_PROMPT_QUESTION_CHARS = Number(process.env.EVAL_PROMPT_QUESTION_CHARS || 320);
const MAX_PROMPT_REASONING_CHARS = Number(process.env.EVAL_PROMPT_REASONING_CHARS || 260);
const MAX_PROMPT_COMPANY_CHARS = Number(process.env.EVAL_PROMPT_COMPANY_CHARS || 700);
const MAX_PROMPT_RUBRIC_POINTS = Number(process.env.EVAL_PROMPT_RUBRIC_POINTS || 8);
const LLM_CACHE_ENABLED = process.env.EVAL_LLM_CACHE !== "0";
const LLM_CACHE_LIMIT = Number(process.env.EVAL_LLM_CACHE_LIMIT || 400);
const FORCE_LLM_GRADING = process.env.EVAL_FORCE_LLM === "1";

const llmGradeCache = new Map();

const safeCosine = (a, b) => {
  const v = cosineSimilarity(a, b);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
};

const clamp01 = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
};

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const trimForPrompt = (value, maxChars) => {
  const text = toSafeString(value);
  if (!text) return "";
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
};

const compactCompanyContextForPrompt = (companyContext) => {
  if (!companyContext || typeof companyContext !== "object") return {};
  const compact = {
    name: companyContext?.name,
    role: companyContext?.role,
    domain: companyContext?.domain,
    techStack: companyContext?.techStack,
    interviewFocus: companyContext?.interviewFocus,
    skills: companyContext?.skills,
  };
  const serialized = trimForPrompt(JSON.stringify(compact), MAX_PROMPT_COMPANY_CHARS);
  if (!serialized) return {};
  try {
    return JSON.parse(serialized);
  } catch {
    return { snippet: serialized };
  }
};

const sanitizeRubricForPrompt = (rubricPoints = []) => {
  const points = Array.isArray(rubricPoints) ? rubricPoints : [];
  return points
    .slice()
    .sort((a, b) => {
      const rank = (importance) =>
        importance === "mustHave" ? 0 : importance === "redFlag" ? 1 : 2;
      return rank(toSafeString(a?.importance)) - rank(toSafeString(b?.importance));
    })
    .slice(0, MAX_PROMPT_RUBRIC_POINTS)
    .map((point) => ({
      text: trimForPrompt(point?.text, 150),
      category: toSafeString(point?.category, "coverage"),
      importance: toSafeString(point?.importance, "mustHave"),
    }));
};

const makeLLMCacheKey = ({ question, answer, type, rubricPoints }) => {
  const rubricKey = (Array.isArray(rubricPoints) ? rubricPoints : [])
    .slice(0, MAX_PROMPT_RUBRIC_POINTS)
    .map((point) => `${toSafeString(point?.text)}|${toSafeString(point?.importance)}`)
    .join("||");
  return [
    type,
    trimForPrompt(question, 180),
    trimForPrompt(answer, 700),
    rubricKey,
  ].join("::");
};

const setLLMCache = (key, value) => {
  if (!LLM_CACHE_ENABLED || !key) return;
  llmGradeCache.set(key, value);
  if (llmGradeCache.size <= LLM_CACHE_LIMIT) return;
  const oldestKey = llmGradeCache.keys().next().value;
  if (oldestKey) {
    llmGradeCache.delete(oldestKey);
  }
};

const tokenize = (text) =>
  toSafeString(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);

const detectQuestionType = (question, rubricPoints = []) => {
  const answerModes = new Set(
    (Array.isArray(rubricPoints) ? rubricPoints : [])
      .map((point) => toSafeString(point?.expectedAnswerMode))
      .filter(Boolean)
  );
  if (answerModes.has("design")) return "system_design";
  if (answerModes.has("story")) return "behavioral";
  if (answerModes.has("code")) return "coding";

  const q = toSafeString(question).toLowerCase();
  if (/design|architecture|scalable|system/.test(q)) return "system_design";
  if (/tell me about|situation|experience|challenge|conflict|led/.test(q))
    return "behavioral";
  if (/array|function|return|code|algorithm|complexity|implement/.test(q))
    return "coding";
  return "general";
};

const isCodeAnswer = (text) => {
  return /{|}|;|=>|#include|function|return|def\s|class\s|for\s*\(|while\s*\(/.test(text);
};

const detectStructure = (text) => {
  const lower = toSafeString(text).toLowerCase();
  let score = 0;
  if (/situation|context|problem/.test(lower)) score += 0.25;
  if (/task|goal|objective/.test(lower)) score += 0.2;
  if (/action|approach|implemented|decided/.test(lower)) score += 0.3;
  if (/result|impact|outcome|learned/.test(lower)) score += 0.25;
  return clamp01(score);
};

const clarityScore = (text) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) return 0;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return 0.05;
  if (words.length <= 6) return 0.18;
  if (words.length <= 12) return 0.35;

  const sentences = trimmed.split(/[.!?]+/).filter(Boolean);
  if (!sentences.length) return 0.25;
  const avg = words.length / sentences.length;

  if (avg >= 8 && avg <= 22) return 0.9;
  if (avg >= 5 && avg <= 28) return 0.7;
  return 0.45;
};

const buildRubricBuckets = (rubricPoints, { mustHaveCoverageWhenEmpty = 1 } = {}) => {
  const points = Array.isArray(rubricPoints) ? rubricPoints : [];
  const emptyMustHaveDefault = clamp01(mustHaveCoverageWhenEmpty);
  const matchedRubricPoints = [];
  const missingRubricPoints = [];
  const criticalMisses = [];
  const mustHavePoints = [];
  const matchedMustHavePoints = [];
  const categoryScores = {};
  let weightedSum = 0;
  let weightTotal = 0;

  for (const point of points) {
    const importance = toSafeString(point?.importance, "mustHave");
    const category = toSafeString(point?.category, "coverage");
    const similarity = clamp01(point?.similarity);
    const weight = importance === "mustHave" ? 1.5 : importance === "redFlag" ? 1.2 : 0.65;
    weightedSum += similarity * weight;
    weightTotal += weight;
    categoryScores[category] = categoryScores[category] || [];
    categoryScores[category].push(similarity);
    if (importance === "mustHave") {
      mustHavePoints.push(point.text);
    }

    if (similarity >= RUBRIC_MATCH_THRESHOLD) {
      matchedRubricPoints.push(point.text);
      if (importance === "mustHave") {
        matchedMustHavePoints.push(point.text);
      }
    } else {
      missingRubricPoints.push(point.text);
      if (importance === "mustHave") criticalMisses.push(point.text);
    }
  }

  const averagedCategories = Object.fromEntries(
    Object.entries(categoryScores).map(([key, values]) => [
      key,
      values.reduce((sum, value) => sum + value, 0) / values.length,
    ])
  );

  return {
    coverage: weightTotal > 0 ? weightedSum / weightTotal : 0,
    matchedRubricPoints,
    missingRubricPoints,
    criticalMisses,
    mustHavePoints,
    matchedMustHavePoints,
    mustHaveCoverage:
      mustHavePoints.length > 0
        ? matchedMustHavePoints.length / mustHavePoints.length
        : emptyMustHaveDefault,
    categoryScores: averagedCategories,
  };
};

const buildBaseSubscores = ({
  type,
  answer,
  clarity,
  relevance,
  coverage,
  categoryScores,
  structure,
}) => {
  const text = toSafeString(answer).toLowerCase();
  const wordCount = tokenize(answer).length;
  const codePresent = isCodeAnswer(answer);
  const hasTradeoffLanguage = /(trade.?off|pros?|cons?|latency|consistency|throughput|bottleneck)/.test(text);
  const hasFailureLanguage = /(failure|retry|fallback|reliability|downtime|outage|degrade)/.test(text);

  const shared = {
    relevance,
    coverage,
    correctness: clamp01(0.45 * coverage + 0.35 * relevance + 0.2 * clarity),
    communication: clamp01(0.7 * clarity + 0.3 * Math.min(1, wordCount / 40)),
  };

  if (type === "coding") {
    return {
      ...shared,
      algorithmChoice: clamp01(categoryScores.algorithmChoice ?? coverage * 0.95),
      edgeCases: clamp01(categoryScores.edgeCases ?? Math.min(coverage, relevance) * 0.9),
      complexityAwareness: clamp01(
        categoryScores.complexityAwareness ?? (/(time|space|complexity|big o|o\()/.test(text) ? 0.75 : 0.2)
      ),
      implementationQuality: clamp01(
        categoryScores.implementationQuality ?? (codePresent ? 0.68 : 0.15)
      ),
    };
  }

  if (type === "system_design") {
    return {
      ...shared,
      architectureCoverage: clamp01(
        categoryScores.architectureCoverage ??
          (/(api|service|database|queue|cache|worker|storage)/.test(text) ? 0.75 : 0.22)
      ),
      tradeoffs: clamp01(categoryScores.tradeoffs ?? (hasTradeoffLanguage ? 0.72 : 0.2)),
      scalability: clamp01(
        categoryScores.scalability ?? (/(scale|partition|shard|load balancer|cdn)/.test(text) ? 0.72 : 0.22)
      ),
      failureHandling: clamp01(categoryScores.failureHandling ?? (hasFailureLanguage ? 0.72 : 0.15)),
    };
  }

  if (type === "behavioral") {
    return {
      ...shared,
      situationClarity: clamp01(categoryScores.situationClarity ?? structure * 0.95),
      actionOwnership: clamp01(
        categoryScores.actionOwnership ?? (/\b(i|my|personally|led|owned|implemented)\b/.test(text) ? 0.72 : 0.25)
      ),
      resultSpecificity: clamp01(
        categoryScores.resultSpecificity ?? (/\d+|percent|improved|reduced|increased|impact/.test(text) ? 0.72 : 0.22)
      ),
      reflection: clamp01(categoryScores.reflection ?? (/learned|next time|would improve/.test(text) ? 0.68 : 0.18)),
    };
  }

  return {
    ...shared,
    reasoning: clamp01(categoryScores.reasoning ?? Math.max(relevance, coverage * 0.9)),
  };
};

const combineWeightedScore = (weights, subscores) => {
  const entries = Object.entries(weights);
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) return 0;
  const weighted = entries.reduce(
    (sum, [key, weight]) => sum + clamp01(subscores[key]) * weight,
    0
  );
  return weighted / totalWeight;
};

const QUESTION_TYPE_WEIGHTS = {
  coding: {
    relevance: 0.12,
    coverage: 0.16,
    correctness: 0.16,
    communication: 0.08,
    algorithmChoice: 0.18,
    edgeCases: 0.12,
    complexityAwareness: 0.08,
    implementationQuality: 0.1,
  },
  system_design: {
    relevance: 0.1,
    coverage: 0.16,
    correctness: 0.14,
    communication: 0.1,
    architectureCoverage: 0.16,
    tradeoffs: 0.12,
    scalability: 0.12,
    failureHandling: 0.1,
  },
  behavioral: {
    relevance: 0.12,
    coverage: 0.14,
    correctness: 0.1,
    communication: 0.12,
    situationClarity: 0.14,
    actionOwnership: 0.16,
    resultSpecificity: 0.14,
    reflection: 0.08,
  },
  general: {
    relevance: 0.28,
    coverage: 0.28,
    correctness: 0.24,
    communication: 0.12,
    reasoning: 0.08,
  },
};

const STRUCTURED_FEEDBACK_MAX_CHARS = Number(process.env.EVAL_FEEDBACK_MAX_CHARS || 900);

const trimFeedbackSection = (value, maxChars = 320) => {
  const text = toSafeString(value);
  if (!text) return "";
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
};

/** Precise per-question feedback for non–code_execution rounds (SQL, HR, CS, system design, etc.). */
const buildStructuredFeedback = ({
  finalScore,
  expectedAnswer,
  closeness,
  improvements = [],
}) => {
  const improveItems = (Array.isArray(improvements) ? improvements : [])
    .map((item) => toSafeString(item))
    .filter(Boolean)
    .slice(0, 2);
  const improveText =
    improveItems.length > 0
      ? improveItems.join(" ")
      : "Strengthen the missing rubric points in your next answer.";

  const sections = [
    `Score: ${finalScore}/10`,
    `Expected answer: ${trimFeedbackSection(expectedAnswer, 280)}`,
    `How close your answer was: ${trimFeedbackSection(closeness, 280)}`,
    `What to improve: ${trimFeedbackSection(improveText, 220)}`,
  ];

  return sections.join("\n\n").slice(0, STRUCTURED_FEEDBACK_MAX_CHARS);
};

const buildDeterministicStructuredFeedback = ({
  finalScore,
  rubricPoints = [],
  matchedRubricPoints = [],
  missingRubricPoints = [],
}) => {
  const rubricTexts = (Array.isArray(rubricPoints) ? rubricPoints : [])
    .map((point) => toSafeString(point?.text))
    .filter(Boolean);

  const expectedAnswer =
    rubricTexts.length > 0
      ? `Interviewers expect you to cover: ${rubricTexts.slice(0, 5).join("; ")}.`
      : "Interviewers expect a direct, complete answer that addresses the question.";

  let closeness;
  if (matchedRubricPoints.length > 0 && missingRubricPoints.length > 0) {
    closeness = `You hit: ${matchedRubricPoints.slice(0, 3).join("; ")}. You missed: ${missingRubricPoints.slice(0, 3).join("; ")}.`;
  } else if (matchedRubricPoints.length > 0) {
    closeness = `You aligned well with what interviewers look for: ${matchedRubricPoints.slice(0, 4).join("; ")}.`;
  } else if (missingRubricPoints.length > 0) {
    closeness = `Your answer did not clearly cover: ${missingRubricPoints.slice(0, 4).join("; ")}.`;
  } else {
    closeness = "Your answer was too brief or off-topic to match the expected bar.";
  }

  const improvements = missingRubricPoints
    .slice(0, 2)
    .map((text) => (text.startsWith("Add") ? text : `Add: ${text}`));

  return buildStructuredFeedback({
    finalScore,
    expectedAnswer,
    closeness,
    improvements,
  });
};

const parseLlmStructuredFeedback = (parsedEval) => {
  const improvements = [];
  if (Array.isArray(parsedEval?.improvements)) {
    for (const item of parsedEval.improvements) {
      const safe = toSafeString(item);
      if (safe) improvements.push(safe);
    }
  }
  const legacyImprovement = toSafeString(parsedEval?.improvement);
  if (legacyImprovement && improvements.length === 0) {
    improvements.push(legacyImprovement);
  }

  const expectedAnswer =
    toSafeString(parsedEval?.expectedAnswer) ||
    toSafeString(parsedEval?.insight);

  const closeness =
    toSafeString(parsedEval?.closeness) ||
    (toSafeString(parsedEval?.insight) && !toSafeString(parsedEval?.expectedAnswer)
      ? toSafeString(parsedEval?.insight)
      : "");

  return { expectedAnswer, closeness, improvements };
};

const deriveStrictVerdict = ({
  llmVerdict,
  relevance,
  mustHaveCoverage,
  criticalMisses,
  normalizedScore,
  wordCount,
}) => {
  if (wordCount <= 4 || relevance < 0.45) return "incorrect";
  if (criticalMisses.length >= 2) return "incorrect";
  if (mustHaveCoverage < 0.5) return "incorrect";
  if (
    llmVerdict === "correct" &&
    normalizedScore >= 0.8 &&
    mustHaveCoverage >= 0.85 &&
    relevance >= 0.72
  ) {
    return "correct";
  }
  if (normalizedScore >= 0.82 && mustHaveCoverage >= 0.9 && relevance >= 0.75) {
    return "correct";
  }
  if (normalizedScore < RUBRIC_PARTIAL_THRESHOLD || mustHaveCoverage < 0.7) {
    return "partial";
  }
  return llmVerdict === "incorrect" ? "partial" : llmVerdict || "partial";
};

const buildLLMGradingPrompt = ({
  question,
  answer,
  type,
  companyContext,
  llmReasoning,
  rubricPoints,
  baseSubscores,
  strictGenerated = false,
}) => [
  {
    role: "system",
    content: strictGenerated
      ? "You are a strict technical interview grader for LLM-authored questions. Factual correctness matters more than fluency or confidence. Return strict JSON only. If the answer is factually wrong, incomplete, or mostly off-target, verdict MUST be incorrect and subscores must be <= 0.3. Do not award rubric credit without clear evidence in the answer text. No praise or filler."
      : "You are a strict but fair interview grader. Return strict JSON only. Judge the answer against the rubric. Be precise and concise—no filler, praise, or generic coaching. Do not invent rubric points or give credit without evidence in the answer.",
  },
  {
    role: "user",
    content: `Question: ${trimForPrompt(question, MAX_PROMPT_QUESTION_CHARS)}
Candidate Answer: ${trimForPrompt(answer, MAX_PROMPT_ANSWER_CHARS)}
Question Type: ${type}
Company Context: ${JSON.stringify(compactCompanyContextForPrompt(companyContext))}
${
  strictGenerated
    ? "Reference Reasoning: (not used — judge only the candidate answer and rubric; do not assume facts not stated in the answer.)"
    : `Reference Reasoning: ${trimForPrompt(llmReasoning, MAX_PROMPT_REASONING_CHARS)}`
}
Rubric Points: ${JSON.stringify(
      sanitizeRubricForPrompt(rubricPoints)
    )}
Current Deterministic Subscores: ${JSON.stringify(baseSubscores)}
${
  strictGenerated
    ? `
Strict rules for this generated question:
- Topical similarity or buzzwords alone are NOT sufficient for "correct" or high subscores.
- matchedRubricPoints must only list rubric items clearly supported by the answer.
- If the answer contradicts the question or core rubric, verdict must be incorrect.`
    : ""
}

Return STRICT JSON:
{
  "verdict": "correct | partial | incorrect",
  "confidence": 0.0,
  "expectedAnswer": "2-3 short sentences: what a strong candidate would say (what interviewers expect). No bullet lists.",
  "closeness": "2-3 short sentences: how this answer compares to that bar—what matched and what did not.",
  "improvements": ["one concrete fix", "optional second fix"],
  "matchedRubricPoints": ["string"],
  "missingRubricPoints": ["string"],
  "subscores": {
    "correctness": 0.0,
    "communication": 0.0
  }
}`,
  },
];

const assessGeneratedQuestionFactuality = async ({ question, answer, type }) => {
  try {
    const parsed = parseJSONResponse(
      await callLLM(
        [
          {
            role: "system",
            content:
              "You judge factual correctness only. Return strict JSON. Be strict: vague or wrong answers are not factually correct.",
          },
          {
            role: "user",
            content: `Question (${type}): ${trimForPrompt(question, MAX_PROMPT_QUESTION_CHARS)}
Candidate answer: ${trimForPrompt(answer, MAX_PROMPT_ANSWER_CHARS)}

Is this answer factually correct and materially responsive to the question?
- "factuallyCorrect": true only if core claims are correct for the question.
- topical fluff with errors => false
- empty or evasive => false

Return JSON: { "factuallyCorrect": true|false, "confidence": 0.0, "reason": "one short sentence" }`,
          },
        ],
        { model: LLM_GENERATED_GRADING_MODEL }
      )
    );
    const factuallyCorrect = parsed?.factuallyCorrect === true;
    return {
      factuallyCorrect,
      confidence: clamp01(parsed?.confidence ?? 0.6),
      reason: toSafeString(parsed?.reason),
    };
  } catch {
    return { factuallyCorrect: null, confidence: 0, reason: "" };
  }
};

const shouldUseLLMGrader = ({
  rubricPointCount,
  wordCount,
  relevance,
  mustHaveCoverage,
  deterministicScore,
}) => {
  if (FORCE_LLM_GRADING) return true;
  if (rubricPointCount === 0) return false;
  if (wordCount <= 5) return false;
  if (relevance < 0.45) return false;

  const highConfidenceCorrect =
    deterministicScore >= 0.86 && mustHaveCoverage >= 0.9 && relevance >= 0.78;
  const highConfidenceIncorrect =
    deterministicScore <= 0.24 || (mustHaveCoverage < 0.45 && relevance < 0.55);

  if (highConfidenceCorrect || highConfidenceIncorrect) {
    return false;
  }
  return true;
};

export const evaluateRubricLLM = async ({
  answer,
  question,
  companyContext,
  llmReasoning,
  expectedPoints = [],
  /** When true (e.g. DSA / coding rounds), skip all callLLM grading; deterministic + embeddings only. */
  suppressLlm = false,
  /** "generated" | "retrieved" — strict scoring applies only to generated. */
  questionSource = "",
}) => {
  const safeAnswer = toSafeString(answer);
  const safeQuestion = toSafeString(question);
  const isLlmGenerated = isLlmGeneratedQuestionSource(questionSource);
  const rubricPoints = Array.isArray(expectedPoints) ? expectedPoints : [];
  const type = detectQuestionType(safeQuestion, rubricPoints);
  const expectedAnswerMode =
    toSafeString(rubricPoints[0]?.expectedAnswerMode) ||
    (type === "coding"
      ? "code"
      : type === "system_design"
      ? "design"
      : type === "behavioral"
      ? "story"
      : "conceptual");

  if (type === "coding" && !suppressLlm) {
    logInterviewDsaLlmDebug("rubric_eval_coding_shape_llm_may_run", {
      rubricPointCount: rubricPoints.length,
      expectedAnswerMode,
      hint: "Answer/question looks like code but evaluator is rubric_llm. Prefer code_execution with testcases for DSA.",
    });
  }

  if (!safeAnswer) {
    const emptyFeedback = buildStructuredFeedback({
      finalScore: 1,
      expectedAnswer:
        rubricPoints.length > 0
          ? `Interviewers expect: ${rubricPoints
              .map((point) => toSafeString(point?.text))
              .filter(Boolean)
              .slice(0, 4)
              .join("; ")}.`
          : "A direct answer that addresses the question.",
      closeness: "No answer was submitted.",
      improvements: ["Answer the question and cover the expected points."],
    });
    return {
      score: 1,
      type,
      feedback: emptyFeedback,
      verdict: "incorrect",
      evaluationTrace: {
        scoringVersion: SCORING_VERSION,
        questionType: type,
        expectedAnswerMode,
        verdict: "incorrect",
        confidence: 1,
        relevance: 0,
        coverage: 0,
        correctness: 0,
        communication: 0,
        matchedRubricPoints: [],
        missingRubricPoints: rubricPoints.map((point) => point?.text).filter(Boolean),
        criticalMisses: rubricPoints
          .filter((point) => toSafeString(point?.importance, "mustHave") === "mustHave")
          .map((point) => point?.text)
          .filter(Boolean),
        subscores: {},
      },
    };
  }

  const [userEmbedding, questionEmbedding] = await Promise.all([
    getEmbedding(safeAnswer),
    safeQuestion ? getEmbedding(safeQuestion) : Promise.resolve(null),
  ]);

  const questionRelevance = questionEmbedding
    ? clamp01(safeCosine(questionEmbedding, userEmbedding))
    : 0.45;

  const rubricWithSimilarity = rubricPoints.map((point) => ({
    ...point,
    similarity:
      Array.isArray(point?.embedding) && point.embedding.length > 0
        ? clamp01((safeCosine(point.embedding, userEmbedding) - 0.38) / 0.42)
        : 0,
  }));

  const rubricSummary = buildRubricBuckets(rubricWithSimilarity, {
    mustHaveCoverageWhenEmpty: isLlmGenerated
      ? LLM_GENERATED_EMPTY_MUST_HAVE_COVERAGE
      : 1,
  });
  const clarity = clarityScore(safeAnswer);
  const structure = detectStructure(safeAnswer);
  const wordCount = tokenize(safeAnswer).length;
  const relevance = isLlmGenerated
    ? clamp01(0.35 * questionRelevance + 0.35 * rubricSummary.coverage)
    : clamp01(0.55 * questionRelevance + 0.45 * rubricSummary.coverage);

  let factuality = { factuallyCorrect: null, confidence: 0, reason: "" };
  if (isLlmGenerated && !suppressLlm && safeAnswer) {
    factuality = await assessGeneratedQuestionFactuality({
      question: safeQuestion,
      answer: safeAnswer,
      type,
    });
    logInterviewDsaLlmDebug("rubric_eval_generated_factuality", {
      factuallyCorrect: factuality.factuallyCorrect,
      confidence: factuality.confidence,
    });
  }
  const baseSubscores = buildBaseSubscores({
    type,
    answer: safeAnswer,
    clarity,
    relevance,
    coverage: rubricSummary.coverage,
    categoryScores: rubricSummary.categoryScores,
    structure,
  });
  const weights = QUESTION_TYPE_WEIGHTS[type] || QUESTION_TYPE_WEIGHTS.general;
  const deterministicScore = combineWeightedScore(weights, baseSubscores);

  let llmVerdict = "partial";
  let llmExpectedAnswer = "";
  let llmCloseness = "";
  let llmImprovements = [];
  let llmConfidence = 0.55;
  let llmMatched = [];
  let llmMissing = [];
  let llmSubscores = {};

  const useLLMGrader =
    !suppressLlm &&
    (isLlmGenerated && rubricPoints.length > 0
      ? true
      : shouldUseLLMGrader({
          rubricPointCount: rubricPoints.length,
          wordCount,
          relevance,
          mustHaveCoverage: rubricSummary.mustHaveCoverage,
          deterministicScore,
        }));

  logInterviewDsaLlmDebug("rubric_eval_llm_gate", {
    suppressLlm,
    useLLMGrader,
    isLlmGenerated,
    detectedQuestionType: type,
    rubricPointCount: rubricPoints.length,
    wordCount,
    forceLlmGradingEnv: process.env.EVAL_FORCE_LLM === "1",
  });

  if (useLLMGrader) {
    const cacheKey = [
      makeLLMCacheKey({
        question: safeQuestion,
        answer: safeAnswer,
        type,
        rubricPoints,
      }),
      isLlmGenerated ? "gen-strict-v1" : "bank",
    ].join("::");
    const cached = LLM_CACHE_ENABLED ? llmGradeCache.get(cacheKey) : null;

    try {
      const gradingModel = isLlmGenerated ? LLM_GENERATED_GRADING_MODEL : TOOL_EVAL_MODEL;
      const parsedEval = cached
        ? cached
        : parseJSONResponse(
            await callLLM(
              buildLLMGradingPrompt({
                question: safeQuestion,
                answer: safeAnswer,
                type,
                companyContext,
                llmReasoning: isLlmGenerated ? "" : llmReasoning,
                rubricPoints,
                baseSubscores,
                strictGenerated: isLlmGenerated,
              }),
              { model: gradingModel }
            )
          );

      if (!cached) {
        setLLMCache(cacheKey, parsedEval);
      }

      const verdictCandidate = toSafeString(parsedEval?.verdict).toLowerCase();
      if (["correct", "partial", "incorrect"].includes(verdictCandidate)) {
        llmVerdict = verdictCandidate;
      }
      const structured = parseLlmStructuredFeedback(parsedEval);
      llmExpectedAnswer = structured.expectedAnswer;
      llmCloseness = structured.closeness;
      llmImprovements = structured.improvements;
      llmConfidence = clamp01(parsedEval?.confidence || llmConfidence);
      llmMatched = Array.isArray(parsedEval?.matchedRubricPoints)
        ? parsedEval.matchedRubricPoints.map((item) => toSafeString(item)).filter(Boolean)
        : [];
      llmMissing = Array.isArray(parsedEval?.missingRubricPoints)
        ? parsedEval.missingRubricPoints.map((item) => toSafeString(item)).filter(Boolean)
        : [];
      const rawLlmSubscores =
        parsedEval?.subscores && typeof parsedEval.subscores === "object"
          ? Object.fromEntries(
              Object.entries(parsedEval.subscores)
                .map(([key, value]) => [key, clamp01(value)])
                .filter(([, value]) => Number.isFinite(value))
            )
          : {};
      llmSubscores = isLlmGenerated
        ? clampLlmSubscoresForGenerated(rawLlmSubscores)
        : rawLlmSubscores;

      if (isLlmGenerated && factuality.factuallyCorrect === false) {
        llmVerdict = "incorrect";
        llmSubscores = clampLlmSubscoresForGenerated(llmSubscores);
      }
    } catch (error) {
      // Deterministic path remains the primary fallback.
    }
  }

  if (isLlmGenerated && factuality.factuallyCorrect === false && !useLLMGrader) {
    llmVerdict = "incorrect";
  }

  const mergedSubscores = { ...baseSubscores };
  const llmBlendWeight = isLlmGenerated ? 0.15 : 0.35;
  const detBlendWeight = 1 - llmBlendWeight;
  for (const [key, value] of Object.entries(llmSubscores)) {
    if (key in mergedSubscores) {
      mergedSubscores[key] = clamp01(
        detBlendWeight * mergedSubscores[key] + llmBlendWeight * value
      );
    }
  }

  let normalizedScore = combineWeightedScore(weights, mergedSubscores);

  if (!isLlmGenerated) {
    if (llmVerdict === "correct") normalizedScore += 0.03;
    if (llmVerdict === "incorrect") normalizedScore -= 0.16;
  }
  if (wordCount <= 4) normalizedScore = Math.min(normalizedScore, 0.18);
  if (rubricSummary.mustHaveCoverage < 0.67) normalizedScore *= 0.74;
  if (rubricSummary.mustHaveCoverage < 0.5) normalizedScore *= 0.58;
  if (rubricSummary.criticalMisses.length >= 1) {
    normalizedScore -= Math.min(0.22, rubricSummary.criticalMisses.length * 0.08);
  }
  if (relevance < 0.5) {
    normalizedScore *= 0.6;
  }
  if (relevance < 0.42) {
    normalizedScore = Math.min(normalizedScore, 0.28);
  }

  normalizedScore = clamp01(normalizedScore);

  if (isLlmGenerated) {
    normalizedScore = applyLlmGeneratedDeterministicOverrides(
      rubricSummary,
      relevance,
      normalizedScore
    );
    llmVerdict = deriveStrictVerdictForGenerated({
      llmVerdict,
      relevance,
      mustHaveCoverage: rubricSummary.mustHaveCoverage,
      criticalMisses: rubricSummary.criticalMisses,
      normalizedScore,
      wordCount,
      factuallyCorrect: factuality.factuallyCorrect,
    });
  } else {
    llmVerdict = deriveStrictVerdict({
      llmVerdict,
      relevance,
      mustHaveCoverage: rubricSummary.mustHaveCoverage,
      criticalMisses: rubricSummary.criticalMisses,
      normalizedScore,
      wordCount,
    });
  }

  let finalScore = Math.max(1, Math.min(10, Math.round(normalizedScore * 10)));

  if (isLlmGenerated) {
    const capped = applyLlmGeneratedVerdictAndFactualityCaps(
      llmVerdict,
      normalizedScore,
      factuality
    );
    llmVerdict = capped.verdict;
    normalizedScore = capped.normalizedScore;
    finalScore = capped.finalScore;
  }

  const matchedRubricPoints = isLlmGenerated
    ? [...rubricSummary.matchedRubricPoints]
    : Array.from(new Set([...rubricSummary.matchedRubricPoints, ...llmMatched]));
  const missingRubricPoints = isLlmGenerated
    ? [...rubricSummary.missingRubricPoints]
    : Array.from(new Set([...rubricSummary.missingRubricPoints, ...llmMissing]));
  const confidence = clamp01(
    0.5 * llmConfidence +
      0.2 * (rubricPoints.length > 0 ? 1 : 0.4) +
      0.2 * relevance +
      0.1 * clarity
  );

  const feedback =
    llmExpectedAnswer || llmCloseness || llmImprovements.length > 0
      ? buildStructuredFeedback({
          finalScore,
          expectedAnswer: llmExpectedAnswer,
          closeness: llmCloseness,
          improvements: llmImprovements,
        })
      : buildDeterministicStructuredFeedback({
          finalScore,
          rubricPoints,
          matchedRubricPoints,
          missingRubricPoints,
        });

  return {
    score: finalScore,
    type,
    feedback,
    verdict: llmVerdict,
    evaluationTrace: {
      scoringVersion: SCORING_VERSION,
      questionType: type,
      expectedAnswerMode,
      verdict: llmVerdict,
      confidence,
      relevance: mergedSubscores.relevance ?? relevance,
      coverage: mergedSubscores.coverage ?? rubricSummary.coverage,
      correctness: mergedSubscores.correctness ?? 0,
      communication: mergedSubscores.communication ?? 0,
      matchedRubricPoints,
      missingRubricPoints,
      criticalMisses: rubricSummary.criticalMisses,
      subscores: mergedSubscores,
      ...(isLlmGenerated
        ? {
            llmGeneratedStrictScoring: true,
            factualityCheck: factuality.factuallyCorrect,
            factualityReason: factuality.reason || undefined,
          }
        : {}),
    },
  };
};

export default evaluateRubricLLM;
