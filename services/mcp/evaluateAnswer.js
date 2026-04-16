import { getEmbedding, cosineSimilarity } from "../../utils/embedding.js";
import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";

const TOOL_EVAL_MODEL = process.env.GROQ_TOOL_MODEL || "llama-3.1-8b-instant";
const SCORING_VERSION = "v3-rubric-strict";
const RUBRIC_MATCH_THRESHOLD = 0.72;
const RUBRIC_PARTIAL_THRESHOLD = 0.55;

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

const extractReasoningHighlight = (reasoning) => {
  const text = toSafeString(reasoning);
  if (!text) return "";
  const firstSentence = text.split(/[.!?]/)[0]?.trim() || "";
  if (!firstSentence) return "";
  return firstSentence.length > 140
    ? `${firstSentence.slice(0, 137).trimEnd()}...`
    : firstSentence;
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

const buildRubricBuckets = (rubricPoints) => {
  const points = Array.isArray(rubricPoints) ? rubricPoints : [];
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
        : 1,
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

const buildHumanFeedback = ({
  type,
  finalScore,
  matchedRubricPoints,
  missingRubricPoints,
  reasoningHighlight,
  llmInsight,
  llmImprovement,
}) => {
  const lines = [];

  if (finalScore >= 8) {
    lines.push("Good answer. This felt interview-ready overall.");
  } else if (finalScore >= 6) {
    lines.push("You're on the right track, but there is still room to make the answer sharper.");
  } else {
    lines.push("This answer needs stronger completeness and precision to land well in a real interview.");
  }

  if (matchedRubricPoints.length > 0) {
    lines.push(`You covered well: ${matchedRubricPoints.slice(0, 2).join("; ")}.`);
  }
  if (missingRubricPoints.length > 0) {
    lines.push(`What was missing: ${missingRubricPoints.slice(0, 2).join("; ")}.`);
  }

  if (type === "coding" && missingRubricPoints.length > 0) {
    lines.push("For coding rounds, prioritize the approach, edge cases, and executable logic over general explanation.");
  }
  if (type === "system_design" && missingRubricPoints.length > 0) {
    lines.push("For design rounds, make the components, trade-offs, and failure handling explicit.");
  }
  if (type === "behavioral" && missingRubricPoints.length > 0) {
    lines.push("For behavioral rounds, keep the response grounded in your actions and measurable outcomes.");
  }

  if (reasoningHighlight) {
    lines.push(`What stood out: ${reasoningHighlight}.`);
  }
  if (llmInsight) {
    lines.push(llmInsight);
  }
  if (llmImprovement) {
    lines.push(`Suggestion: ${llmImprovement}`);
  }

  return lines.slice(0, 6).join(" ").slice(0, 1200);
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
}) => [
  {
    role: "system",
    content:
      "You are a strict but fair interview grader. Return strict JSON only. Judge the answer against the rubric points. Do not invent rubric points or give credit without evidence from the answer.",
  },
  {
    role: "user",
    content: `Question: ${question}
Candidate Answer: ${answer}
Question Type: ${type}
Company Context: ${JSON.stringify(companyContext || {})}
Reference Reasoning: ${toSafeString(llmReasoning)}
Rubric Points: ${JSON.stringify(
      rubricPoints.map((point) => ({
        text: point.text,
        category: point.category,
        importance: point.importance,
      }))
    )}
Current Deterministic Subscores: ${JSON.stringify(baseSubscores)}

Return STRICT JSON:
{
  "verdict": "correct | partial | incorrect",
  "confidence": 0.0,
  "insight": "one concise paragraph",
  "improvement": "one clear actionable suggestion",
  "matchedRubricPoints": ["string"],
  "missingRubricPoints": ["string"],
  "subscores": {
    "correctness": 0.0,
    "communication": 0.0
  }
}`,
  },
];

export const evaluateAnswer = async ({
  answer,
  question,
  companyContext,
  llmReasoning,
  expectedPoints = [],
}) => {
  const safeAnswer = toSafeString(answer);
  const safeQuestion = toSafeString(question);
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

  if (!safeAnswer) {
    return {
      score: 1,
      type,
      feedback: "No answer was provided. Try answering directly and covering the key points of the question.",
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

  const rubricSummary = buildRubricBuckets(rubricWithSimilarity);
  const reasoningHighlight = extractReasoningHighlight(llmReasoning);
  const clarity = clarityScore(safeAnswer);
  const structure = detectStructure(safeAnswer);
  const wordCount = tokenize(safeAnswer).length;
  const relevance = clamp01(0.55 * questionRelevance + 0.45 * rubricSummary.coverage);
  const baseSubscores = buildBaseSubscores({
    type,
    answer: safeAnswer,
    clarity,
    relevance,
    coverage: rubricSummary.coverage,
    categoryScores: rubricSummary.categoryScores,
    structure,
  });

  let llmVerdict = "partial";
  let llmInsight = "";
  let llmImprovement = "";
  let llmConfidence = 0.55;
  let llmMatched = [];
  let llmMissing = [];
  let llmSubscores = {};

  try {
    const llmEvalRaw = await callLLM(
      buildLLMGradingPrompt({
        question: safeQuestion,
        answer: safeAnswer,
        type,
        companyContext,
        llmReasoning,
        rubricPoints,
        baseSubscores,
      }),
      { model: TOOL_EVAL_MODEL }
    );
    const parsedEval = parseJSONResponse(llmEvalRaw);
    const verdictCandidate = toSafeString(parsedEval?.verdict).toLowerCase();
    if (["correct", "partial", "incorrect"].includes(verdictCandidate)) {
      llmVerdict = verdictCandidate;
    }
    llmInsight = toSafeString(parsedEval?.insight);
    llmImprovement = toSafeString(parsedEval?.improvement);
    llmConfidence = clamp01(parsedEval?.confidence || llmConfidence);
    llmMatched = Array.isArray(parsedEval?.matchedRubricPoints)
      ? parsedEval.matchedRubricPoints.map((item) => toSafeString(item)).filter(Boolean)
      : [];
    llmMissing = Array.isArray(parsedEval?.missingRubricPoints)
      ? parsedEval.missingRubricPoints.map((item) => toSafeString(item)).filter(Boolean)
      : [];
    llmSubscores =
      parsedEval?.subscores && typeof parsedEval.subscores === "object"
        ? Object.fromEntries(
            Object.entries(parsedEval.subscores)
              .map(([key, value]) => [key, clamp01(value)])
              .filter(([, value]) => Number.isFinite(value))
          )
        : {};
  } catch (error) {
    // Deterministic path remains the primary fallback.
  }

  const mergedSubscores = { ...baseSubscores };
  for (const [key, value] of Object.entries(llmSubscores)) {
    if (key in mergedSubscores) {
      mergedSubscores[key] = clamp01(0.65 * mergedSubscores[key] + 0.35 * value);
    }
  }

  const weights = QUESTION_TYPE_WEIGHTS[type] || QUESTION_TYPE_WEIGHTS.general;
  let normalizedScore = combineWeightedScore(weights, mergedSubscores);

  if (llmVerdict === "correct") normalizedScore += 0.03;
  if (llmVerdict === "incorrect") normalizedScore -= 0.16;
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
  llmVerdict = deriveStrictVerdict({
    llmVerdict,
    relevance,
    mustHaveCoverage: rubricSummary.mustHaveCoverage,
    criticalMisses: rubricSummary.criticalMisses,
    normalizedScore,
    wordCount,
  });
  const finalScore = Math.max(1, Math.min(10, Math.round(normalizedScore * 10)));

  const matchedRubricPoints = Array.from(
    new Set([...rubricSummary.matchedRubricPoints, ...llmMatched])
  );
  const missingRubricPoints = Array.from(
    new Set([...rubricSummary.missingRubricPoints, ...llmMissing])
  );
  const confidence = clamp01(
    0.5 * llmConfidence +
      0.2 * (rubricPoints.length > 0 ? 1 : 0.4) +
      0.2 * relevance +
      0.1 * clarity
  );

  const feedback = buildHumanFeedback({
    type,
    finalScore,
    matchedRubricPoints,
    missingRubricPoints,
    reasoningHighlight,
    llmInsight,
    llmImprovement,
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
    },
  };
};

export default evaluateAnswer;