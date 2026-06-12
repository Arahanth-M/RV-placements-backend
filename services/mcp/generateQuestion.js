import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";
import { addToSet, getJSON, getSetMembers, setJSON } from "../../src/utils/redisHelpers.js";
import { retrieveQuestion } from "../questionRetrievalService.js";
import {
  isInterviewQuestionExcluded,
  mergeInterviewQuestionExclusions,
  normalizeInterviewQuestionText,
} from "../interviewQuestionExclusions.js";
import {
  cloneSerializable,
  roundTypeImpliesCodeExecutionInterview,
} from "../interviewCodeGradingGuards.js";

const MIN_POOL_SIZE = 5;
const MAX_POOL_SIZE = 10;
const QUESTION_POOL_TTL_SECONDS = 60 * 60;
const USER_SEEN_TTL_SECONDS = 24 * 60 * 60;
// Re-enable seen-question dedupe by default; set DISABLE_USER_SEEN_DEDUPE=true to allow repeats.
const DISABLE_USER_SEEN_DEDUPE =
  String(process.env.DISABLE_USER_SEEN_DEDUPE || "").toLowerCase() === "true";

const toSafeString = (value, fallback = "") => {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

const normalizeSupportedCodingLanguagesForSlot = (evaluationStrategy, dsaMetadata) => {
  const strat = toSafeString(evaluationStrategy).toLowerCase();
  if (strat !== "code_execution") return [];
  const raw = Array.isArray(dsaMetadata?.supportedLanguages) ? dsaMetadata.supportedLanguages : [];
  const out = new Set();
  for (const item of raw) {
    const s = String(item || "").toLowerCase().trim();
    if (s === "python" || s === "py") out.add("python");
    if (s === "cpp" || s === "c++" || s === "cxx" || s === "cplusplus") out.add("cpp");
    if (s === "java") out.add("java");
  }
  out.add("python");
  out.add("cpp");
  out.add("java");
  return [...out];
};

/** LLM pool items often omit strategy; align with round type so workers use code_execution when appropriate. */
export const inferEvaluationStrategyForRound = (roundType, pickedStrategy) => {
  const ps = toSafeString(pickedStrategy).toLowerCase();
  if (ps === "code_execution" || ps === "sql_execution" || ps === "rubric_llm" || ps === "behavioral_llm") {
    return ps === "sql_execution" ? "rubric_llm" : ps;
  }
  const rt = toSafeString(roundType).toLowerCase();
  if (rt.includes("sql")) return "rubric_llm";
  if (roundTypeImpliesCodeExecutionInterview(roundType)) return "code_execution";
  return "rubric_llm";
};

const truncateText = (value, max = 350) => {
  const safe = toSafeString(value);
  if (!safe) return "";
  if (safe.length <= max) return safe;
  return `${safe.slice(0, max - 3).trimEnd()}...`;
};

const normalizeDifficulty = (value) => {
  const safe = toSafeString(value, "medium").toLowerCase();
  if (safe === "easy" || safe === "medium" || safe === "hard") return safe;
  return "medium";
};

const normalizeCacheToken = (value, fallback = "general") => {
  const safe = toSafeString(value, fallback).toLowerCase();
  return safe.replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "") || fallback;
};

const normalizeExclusions = (values = []) => {
  if (!Array.isArray(values)) return [];
  return values.map((value) => toSafeString(value)).filter(Boolean);
};

const normalizePlacementSliceToken = (
  visitType,
  cluster,
  placementYear,
  mergePlacementByType = false
) => {
  if (mergePlacementByType) {
    const t =
      visitType == null || String(visitType).trim() === ""
        ? ""
        : String(visitType).trim();
    const typeTok =
      t === "" ? "default_type" : normalizeCacheToken(t, "type");
    return `${typeTok}:merged_by_visit_type`;
  }
  const t =
    visitType == null || String(visitType).trim() === ""
      ? ""
      : String(visitType).trim();
  const c =
    cluster == null || String(cluster).trim() === ""
      ? ""
      : String(cluster).trim();
  const y = Number(placementYear);
  const yearTok = Number.isFinite(y) ? String(Math.trunc(y)) : "year";
  const typeTok =
    t === "" ? "default_type" : normalizeCacheToken(t, "type");
  const clusterTok =
    c === "" ? "default_cluster" : normalizeCacheToken(c, "cluster");
  return `${typeTok}:${yearTok}:${clusterTok}`;
};

const buildQuestionPoolCacheKey = ({
  companyContext,
  roundType,
  difficulty,
  placementVisitType,
  placementCluster,
  placementYear,
  mergePlacementByType,
}) => {
  const company = normalizeCacheToken(
    companyContext?.name || companyContext?.companyName,
    "unknown_company"
  );
  const slice = normalizePlacementSliceToken(
    placementVisitType,
    placementCluster,
    placementYear,
    mergePlacementByType === true
  );
  const type = normalizeCacheToken(roundType, "general");
  const level = normalizeDifficulty(difficulty);
  return `${company}:${slice}:${type}:${level}`;
};

const buildSeenQuestionsKey = (userId) => {
  const normalizedUserId = normalizeCacheToken(userId, "anonymous");
  return `user:${normalizedUserId}:seen_questions`;
};

const normalizeQuestionTextKey = normalizeInterviewQuestionText;

const buildSeenTokenFromQuestionId = (questionId) => {
  const safe = toSafeString(questionId);
  return safe ? `id:${safe}` : "";
};

const buildSeenTokenFromQuestionText = (questionText) => {
  const safe = normalizeQuestionTextKey(questionText);
  return safe ? `text:${safe}` : "";
};

const parseSeenQuestionMembers = (members = []) => {
  const seenIdSet = new Set();
  const seenTextSet = new Set();
  for (const member of Array.isArray(members) ? members : []) {
    const safe = toSafeString(member);
    if (!safe) continue;
    if (safe.startsWith("id:")) {
      const idValue = toSafeString(safe.slice(3));
      if (idValue) seenIdSet.add(idValue);
      continue;
    }
    if (safe.startsWith("text:")) {
      const textValue = normalizeQuestionTextKey(safe.slice(5));
      if (textValue) seenTextSet.add(textValue);
      continue;
    }
    // Backward compatibility: historic members were plain normalized question text.
    seenTextSet.add(normalizeQuestionTextKey(safe));
  }
  return { seenIdSet, seenTextSet };
};

const normalizeRubricImportance = (value) => {
  const safe = toSafeString(value, "mustHave");
  return ["mustHave", "goodToHave", "redFlag"].includes(safe)
    ? safe
    : "mustHave";
};

const normalizeRubricCategory = (value, fallback = "coverage") => {
  return toSafeString(value, fallback) || fallback;
};

const normalizeExpectedAnswerMode = (value, fallback = "conceptual") => {
  const safe = toSafeString(value, fallback);
  return ["code", "design", "story", "conceptual"].includes(safe)
    ? safe
    : fallback;
};

const inferAnswerModeFromRoundType = (roundType) => {
  const safeRoundType = toSafeString(roundType, "general").toLowerCase();
  if (safeRoundType.includes("system")) return "design";
  if (safeRoundType.includes("sql")) return "code";
  if (
    safeRoundType.includes("cs fundamentals") ||
    safeRoundType.includes("oops") ||
    safeRoundType.includes("dbms") ||
    safeRoundType.includes("computer network")
  ) {
    return "conceptual";
  }
  if (safeRoundType.includes("hr") || safeRoundType.includes("behavior")) return "story";
  if (safeRoundType.includes("dsa") || safeRoundType.includes("coding")) return "code";
  return "conceptual";
};

export const normalizeExpectedPoint = (point, defaults = {}) => {
  const baseAnswerMode = normalizeExpectedAnswerMode(
    defaults.expectedAnswerMode,
    inferAnswerModeFromRoundType(defaults.roundType)
  );

  if (typeof point === "string") {
    const text = toSafeString(point);
    if (!text) return null;
    return {
      text,
      category: normalizeRubricCategory(defaults.category, "coverage"),
      importance: normalizeRubricImportance(defaults.importance),
      expectedAnswerMode: baseAnswerMode,
      embedding: [],
    };
  }

  if (!point || typeof point !== "object" || Array.isArray(point)) return null;
  const text = toSafeString(point.text || point.point || point.content);
  if (!text) return null;

  return {
    text,
    category: normalizeRubricCategory(point.category, defaults.category || "coverage"),
    importance: normalizeRubricImportance(point.importance || defaults.importance),
    expectedAnswerMode: normalizeExpectedAnswerMode(
      point.expectedAnswerMode,
      baseAnswerMode
    ),
    embedding: Array.isArray(point.embedding)
      ? point.embedding
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      : [],
  };
};

export const normalizeExpectedPoints = (value, defaults = {}) => {
  if (!Array.isArray(value)) return [];
  return value.map((point) => normalizeExpectedPoint(point, defaults)).filter(Boolean);
};

const normalizePoolItem = (item) => {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const question = toSafeString(item.question);
    if (!question) return null;
    return {
      question,
      expectedAnswerMode: normalizeExpectedAnswerMode(
        item.expectedAnswerMode,
        inferAnswerModeFromRoundType(item.roundType)
      ),
      expectedPoints: normalizeExpectedPoints(item.expectedPoints, {
        roundType: item.roundType,
        expectedAnswerMode: item.expectedAnswerMode,
      }),
      evaluationStrategy: toSafeString(item.evaluationStrategy),
      questionId: toSafeString(item.questionId),
      url: toSafeString(item.url),
      dsaMetadata: item.dsaMetadata && typeof item.dsaMetadata === "object" ? item.dsaMetadata : undefined,
    };
  }
  const question = toSafeString(item);
  if (!question) return null;
  return { question, url: "", expectedAnswerMode: "conceptual", expectedPoints: [] };
};

const normalizeQuestionPool = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map(normalizePoolItem).filter(Boolean);
};

const parseLLMQuestionEntries = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizePoolItem).filter(Boolean);
};

const mergeUniqueQuestions = (...questionLists) => {
  const merged = [];
  const seen = new Set();

  questionLists
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .forEach((item) => {
      const entry = normalizePoolItem(item);
      if (!entry) return;
      const key = entry.question.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(entry);
    });

  return merged;
};

const formatPreviousFeedbackForPrompt = (feedback) => {
  const safe = toSafeString(feedback);
  if (!safe) return "N/A";
  const improveMatch = safe.match(/What to improve:\s*([\s\S]+?)(?:\n\n|$)/i);
  if (improveMatch?.[1]) {
    return truncateText(improveMatch[1].trim(), 320);
  }
  const closenessMatch = safe.match(/How close:\s*([\s\S]+?)(?:\n\nWhat to improve:|$)/i);
  if (closenessMatch?.[1]) {
    return truncateText(closenessMatch[1].trim(), 280);
  }
  return truncateText(safe, 360);
};

const isSingleQuestionHrRound = (roundType, roundQuestionCount) => {
  const safeType = toSafeString(roundType).toLowerCase();
  const count = Number(roundQuestionCount);
  return (safeType.includes("hr") || safeType.includes("behavior")) && count === 1;
};

const getPoolMinSizeForRound = (roundType, roundQuestionCount) =>
  isSingleQuestionHrRound(roundType, roundQuestionCount) ? 1 : MIN_POOL_SIZE;

const buildRoundSpecificPromptRules = (roundType, roundAbout, options = {}) => {
  const safeType = toSafeString(roundType, "DSA").toLowerCase();
  const topic = toSafeString(roundAbout, "this topic");
  const singleHr = options.singleQuestionHrRound === true;

  if (safeType.includes("hr") || safeType.includes("behavior")) {
    return `HR / behavioral round rules:
- Ask STAR-style behavioral questions (situation, action, result) tied to: ${topic}.
- Prefer prompts about real past experience, teamwork, conflict, leadership, or motivation.
- expectedAnswerMode should be "story".
- Rubric categories: situationClarity, actionOwnership, resultSpecificity, reflection.${
      singleHr
        ? `
- This HR round has exactly ONE question for the entire round. Generate one substantive, interview-realistic STAR prompt (not generic small talk).
- The question must be specific enough that a strong answer covers situation, personal action, and outcome.`
        : ""
    }`;
  }

  if (safeType.includes("system")) {
    return `System design round rules:
- Ask an open-ended design question focused on: ${topic}.
- Expect trade-offs (scale, consistency, latency, cost), components, and failure handling.
- expectedAnswerMode should be "design".
- Rubric categories: architectureCoverage, tradeoffs, scalability, failureHandling.`;
  }

  if (safeType.includes("sql")) {
    return `SQL round rules:
- Ask practical SQL scenarios (queries, schema reasoning, optimization) for: ${topic}.
- Questions may reference realistic table relationships; avoid trivia-only definitions.
- expectedAnswerMode should be "code" (SQL as the answer medium).
- Rubric categories: queryDesign, correctness, performance, edgeCases.`;
  }

  if (
    safeType.includes("cs fundamentals") ||
    safeType.includes("oops") ||
    safeType.includes("dbms") ||
    safeType.includes("computer network")
  ) {
    return `CS fundamentals round rules:
- Ask conceptual depth questions on: ${topic} (definitions, trade-offs, real-world use).
- Avoid full coding implementations unless the focus clearly requires it.
- expectedAnswerMode should be "conceptual".
- Rubric categories: coverage, reasoning, tradeoffs, application.`;
  }

  if (safeType.includes("dsa") || safeType.includes("coding")) {
    return `DSA / coding round rules (LLM pool only — bank may supply executable problems):
- Ask algorithmic problems aligned with: ${topic}.
- Include constraints, edge cases, and complexity expectations in the rubric.
- expectedAnswerMode should be "code".
- Rubric categories: algorithmChoice, edgeCases, complexityAwareness, implementationQuality.`;
  }

  return `General technical round rules:
- Stay on topic: ${topic}.
- Match difficulty and follow-up mode.
- Use rubric categories appropriate to the question (coverage, reasoning, communication).`;
};

const buildFollowUpRequirementBlock = (adaptiveFollowUp) => {
  const gap = toSafeString(adaptiveFollowUp?.targetRubricGap);
  const mode = toSafeString(adaptiveFollowUp?.followUpMode);
  if (!gap || (mode !== "repair" && mode !== "clarify")) {
    return "";
  }
  return `
CRITICAL follow-up requirement (followUpMode=${mode}):
The next question MUST directly probe this specific gap from the candidate's last answer:
"${gap}"
Include at least one mustHave rubric point that evaluates whether they addressed this gap.
Do not change the subject until this gap is tested.`;
};

const formatDoNotRepeatQuestionsBlock = (excludedTexts = []) => {
  const list = [...excludedTexts]
    .map((item) => truncateText(String(item || ""), 200))
    .filter(Boolean)
    .slice(0, 15);
  if (!list.length) return "";
  return `

Questions already asked in THIS interview (do NOT repeat or closely paraphrase):
${list.map((q, index) => `${index + 1}. ${q}`).join("\n")}`;
};

const buildQuestionPoolPrompt = ({
  companyContext,
  roundType,
  roundAbout,
  difficulty,
  adaptiveFollowUp,
  hasPreviousAnswer,
  previousQuestion,
  previousAnswer,
  previousFeedback,
  previousScore,
  condensedHistory,
  requestedCount,
  singleQuestionHrRound = false,
  doNotRepeatQuestionTexts = [],
}) => {
  const roundRules = buildRoundSpecificPromptRules(roundType, roundAbout, {
    singleQuestionHrRound,
  });
  const followUpBlock = buildFollowUpRequirementBlock(adaptiveFollowUp);
  const formattedFeedback = formatPreviousFeedbackForPrompt(previousFeedback);

  return [
    {
      role: "system",
      content:
        "You are a real interviewer conducting a live interview. Speak naturally like a human interviewer. Return strict JSON only. No markdown or extra text.",
    },
    {
      role: "user",
      content: `You are in the middle of a live interview.

Generate ${requestedCount} different questions you could ASK NEXT to the candidate.

Company context: ${JSON.stringify(companyContext || {})}
Round type: ${toSafeString(roundType, "DSA")}
Round focus/topic: ${toSafeString(roundAbout, "General interview")}
Base difficulty: ${normalizeDifficulty(difficulty)}
Target difficulty for this question: ${adaptiveFollowUp.targetDifficulty}
Follow-up mode: ${adaptiveFollowUp.followUpMode}
Interviewer intent: ${adaptiveFollowUp.interviewerIntent}
${adaptiveFollowUp.targetRubricGap ? `Target rubric gap to address: ${adaptiveFollowUp.targetRubricGap}` : ""}

Has previous answer in this round: ${hasPreviousAnswer ? "yes" : "no"}
Previous question: ${truncateText(previousQuestion, 220)}
Previous answer: ${truncateText(previousAnswer, 320)}
Previous feedback (what to improve / gaps): ${formattedFeedback}
Previous score: ${
        Number.isFinite(Number(previousScore)) ? Number(previousScore) : "N/A"
      }

Recent round history: ${JSON.stringify(condensedHistory)}

Round-specific interviewer rules:
${roundRules}
${followUpBlock}
${formatDoNotRepeatQuestionsBlock(doNotRepeatQuestionTexts)}

Rules:
1) Speak like a real interviewer, not like a question generator.
2) Use natural conversational phrasing (e.g., "Can you walk me through...", "What would happen if...", "How would you approach...").
3) If previous answer exists, each question should feel like a continuation of the conversation.
4) If previous feedback highlights a gap, the follow-up must target that gap (especially in repair/clarify modes).
5) Avoid robotic phrasing like "Explain..." or "Describe...".
6) Keep each question concise (1-2 sentences max).
7) Do NOT include explanations, only what the interviewer would say.
8) Respect target difficulty, round focus/topic, and follow-up mode.
9) Avoid repeating the same question or asking something unrelated to the round focus.
10) Return exactly ${requestedCount} questions.
11) For each question, include 4-6 rubric points a strong answer should cover.
12) Each rubric point must include: text, category, importance ("mustHave" | "goodToHave" | "redFlag").
13) Set expectedAnswerMode per the round-specific rules above.

Return JSON:
{
  "questions": [
    {
      "question": "...",
      "expectedAnswerMode": "code",
      "expectedPoints": [
        {
          "text": "Mentions time complexity trade-off",
          "category": "complexityAwareness",
          "importance": "mustHave"
        }
      ]
    }
  ]
}`,
    },
  ];
};

const getRandomItem = (array) => {
  if (!Array.isArray(array) || array.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex] ?? null;
};

const buildFallbackRubric = ({ roundType, roundAbout }) => {
  const safeRoundType = toSafeString(roundType, "technical").toLowerCase();
  const safeTopic = toSafeString(roundAbout, "this topic");

  if (safeRoundType.includes("hr") || safeRoundType.includes("behavior")) {
    return normalizeExpectedPoints(
      [
        {
          text: `Clearly frame the situation around ${safeTopic}`,
          category: "situationClarity",
          importance: "mustHave",
        },
        {
          text: "Explain the specific actions you personally took",
          category: "actionOwnership",
          importance: "mustHave",
        },
        {
          text: "End with a concrete result or measurable outcome",
          category: "resultSpecificity",
          importance: "mustHave",
        },
        {
          text: "Reflect on what you learned or would improve",
          category: "reflection",
          importance: "goodToHave",
        },
      ],
      { roundType, expectedAnswerMode: "story" }
    );
  }

  if (safeRoundType.includes("system")) {
    return normalizeExpectedPoints(
      [
        {
          text: `Define the main components needed for the ${safeTopic} design`,
          category: "architectureCoverage",
          importance: "mustHave",
        },
        {
          text: "Discuss scaling or performance bottlenecks",
          category: "scalability",
          importance: "mustHave",
        },
        {
          text: "Mention trade-offs in storage, consistency, or complexity",
          category: "tradeoffs",
          importance: "mustHave",
        },
        {
          text: "Address failure handling or reliability concerns",
          category: "failureHandling",
          importance: "goodToHave",
        },
      ],
      { roundType, expectedAnswerMode: "design" }
    );
  }

  if (safeRoundType.includes("sql")) {
    return normalizeExpectedPoints(
      [
        {
          text: `Choose the right SQL approach for ${safeTopic}`,
          category: "queryDesign",
          importance: "mustHave",
        },
        {
          text: "Handle joins/filters/aggregations correctly",
          category: "correctness",
          importance: "mustHave",
        },
        {
          text: "Discuss performance implications and indexing",
          category: "performance",
          importance: "goodToHave",
        },
        {
          text: "Cover edge cases like nulls or duplicates",
          category: "edgeCases",
          importance: "mustHave",
        },
      ],
      { roundType, expectedAnswerMode: "code" }
    );
  }

  if (
    safeRoundType.includes("cs fundamentals") ||
    safeRoundType.includes("oops") ||
    safeRoundType.includes("dbms") ||
    safeRoundType.includes("computer network")
  ) {
    return normalizeExpectedPoints(
      [
        {
          text: `Explain core concepts for ${safeTopic} clearly`,
          category: "coverage",
          importance: "mustHave",
        },
        {
          text: "Use correct technical terminology and reasoning",
          category: "reasoning",
          importance: "mustHave",
        },
        {
          text: "Compare alternatives or trade-offs where relevant",
          category: "tradeoffs",
          importance: "goodToHave",
        },
        {
          text: "Support explanation with practical examples",
          category: "application",
          importance: "goodToHave",
        },
      ],
      { roundType, expectedAnswerMode: "conceptual" }
    );
  }

  return normalizeExpectedPoints(
    [
      {
        text: `Choose a sound approach for solving the ${safeTopic} problem`,
        category: "algorithmChoice",
        importance: "mustHave",
      },
      {
        text: "Cover edge cases or tricky inputs",
        category: "edgeCases",
        importance: "mustHave",
      },
      {
        text: "Mention time or space complexity",
        category: "complexityAwareness",
        importance: "goodToHave",
      },
      {
        text: "Provide an implementation or clear executable logic",
        category: "implementationQuality",
        importance: "mustHave",
      },
    ],
    { roundType, expectedAnswerMode: "code" }
  );
};

const buildBasicFallbackQuestion = ({ roundType, roundAbout, difficulty }) => {
  const safeRoundType = toSafeString(roundType, "technical").toLowerCase();
  const safeTopic = toSafeString(roundAbout, "this topic");
  const level = normalizeDifficulty(difficulty);

  let question;
  if (safeRoundType.includes("hr") || safeRoundType.includes("behavior")) {
    question = `Can you share a situation where you handled a challenge related to ${safeTopic}, and what result you achieved?`;
  } else if (safeRoundType.includes("system")) {
    question = `How would you design a ${safeTopic} system at ${level} difficulty, and what trade-offs would you consider first?`;
  } else if (safeRoundType.includes("sql")) {
    question = `Can you write or explain an SQL approach for ${safeTopic} at ${level} difficulty, including performance considerations?`;
  } else if (
    safeRoundType.includes("cs fundamentals") ||
    safeRoundType.includes("oops") ||
    safeRoundType.includes("dbms") ||
    safeRoundType.includes("computer network")
  ) {
    question = `Can you explain the key concepts behind ${safeTopic} and how they apply in real systems?`;
  } else {
    question = `Can you walk me through your approach to solving a ${level} ${safeTopic} problem, including edge cases?`;
  }

  return {
    question,
    questionUrl: "",
    expectedAnswerMode: inferAnswerModeFromRoundType(roundType),
    expectedPoints: buildFallbackRubric({ roundType, roundAbout }),
    supportedCodingLanguages: [],
  };
};

const pickFollowUpTargetGap = ({ followUpMode, criticalMisses, missingRubricPoints }) => {
  if (followUpMode !== "repair" && followUpMode !== "clarify") {
    return "";
  }
  const combined = [
    ...(Array.isArray(criticalMisses) ? criticalMisses : []),
    ...(Array.isArray(missingRubricPoints) ? missingRubricPoints : []),
  ]
    .map((item) => toSafeString(item))
    .filter(Boolean);
  const unique = [...new Set(combined)];
  return unique[0] || "";
};

export const getAdaptiveFollowUp = ({
  hasPreviousAnswer,
  previousScore,
  previousEvaluation,
  difficulty,
}) => {
  const baseDifficulty = normalizeDifficulty(difficulty);
  const score = Number(previousScore);
  const priorConfidence = Number(previousEvaluation?.confidence);
  const recentScores = Array.isArray(previousEvaluation?.recentScores)
    ? previousEvaluation.recentScores
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
    : [];
  const smoothedScore = recentScores.length
    ? recentScores.reduce((sum, value) => sum + value, 0) / recentScores.length
    : score;
  const criticalMisses = Array.isArray(previousEvaluation?.criticalMisses)
    ? previousEvaluation.criticalMisses.map((item) => toSafeString(item)).filter(Boolean)
    : [];
  const missingRubricPoints = Array.isArray(previousEvaluation?.missingRubricPoints)
    ? previousEvaluation.missingRubricPoints.map((item) => toSafeString(item)).filter(Boolean)
    : [];
  const lowConfidence = Number.isFinite(priorConfidence) && priorConfidence < 0.55;

  const withTargetGap = (payload) => ({
    ...payload,
    targetRubricGap: pickFollowUpTargetGap({
      followUpMode: payload.followUpMode,
      criticalMisses,
      missingRubricPoints,
    }),
  });

  if (!hasPreviousAnswer || !Number.isFinite(smoothedScore)) {
    return withTargetGap({
      targetDifficulty: baseDifficulty,
      followUpMode: "opening",
      interviewerIntent: "Ask a strong opening question for this round focus.",
    });
  }

  if (criticalMisses.length >= 2) {
    return withTargetGap({
      targetDifficulty: baseDifficulty === "hard" ? "medium" : "easy",
      followUpMode: "repair",
      interviewerIntent:
        "Candidate missed important rubric points. Ask a targeted follow-up that repairs conceptual gaps before moving ahead.",
    });
  }

  if (lowConfidence) {
    return withTargetGap({
      targetDifficulty: baseDifficulty,
      followUpMode: "steady",
      interviewerIntent:
        "Confidence in the previous score is limited. Ask a nearby follow-up at similar difficulty to confirm the candidate's level.",
    });
  }

  if (smoothedScore >= 8) {
    return withTargetGap({
      targetDifficulty: baseDifficulty === "easy" ? "medium" : "hard",
      followUpMode: "challenge",
      interviewerIntent:
        "Candidate did well. Ask a tougher follow-up with deeper reasoning, edge cases, optimization, or trade-off analysis.",
    });
  }

  if (smoothedScore <= 4.5) {
    return withTargetGap({
      targetDifficulty: baseDifficulty === "hard" ? "medium" : "easy",
      followUpMode: "clarify",
      interviewerIntent:
        "Candidate struggled. Ask a clarifying follow-up that checks the weakest rubric point from their last answer before going harder.",
    });
  }

  return withTargetGap({
    targetDifficulty: baseDifficulty,
    followUpMode: "steady",
    interviewerIntent:
      "Candidate is average. Ask a related follow-up at similar difficulty to test consistency and practical application.",
  });
};

/**
 * MCP tool: generateQuestion
 * Generates one interview question (and expectedPoints rubric) for the given round context.
 * @returns {{ question: string, expectedPoints: object[], expectedAnswerMode: string }}
 */
export const generateQuestion = async ({
  userId,
  companyContext,
  roundType,
  roundAbout,
  difficulty,
  previousQuestion,
  previousAnswer,
  previousFeedback,
  previousScore,
  previousEvaluation = null,
  roundHistory = [],
  placementVisitType,
  placementCluster,
  placementYear,
  mergePlacementByType,
  excludedQuestionIds = [],
  excludedQuestionTexts = [],
  roundQuestionCount = null,
}) => {
  const { excludedIdSet, excludedTextSet } = mergeInterviewQuestionExclusions(
    {
      excludedQuestionIds: normalizeExclusions(excludedQuestionIds),
      excludedQuestionTexts: normalizeExclusions(excludedQuestionTexts),
    },
    {}
  );

  try {
    const poolMinSize = getPoolMinSizeForRound(roundType, roundQuestionCount);
    const singleQuestionHrRound = isSingleQuestionHrRound(roundType, roundQuestionCount);

    const seenQuestionsKey = buildSeenQuestionsKey(userId);
    const seenQuestionMembers = DISABLE_USER_SEEN_DEDUPE
      ? []
      : await getSetMembers(seenQuestionsKey);
    const { seenIdSet, seenTextSet } = parseSeenQuestionMembers(seenQuestionMembers);

    const retrievalExclusions = Array.from(new Set([...excludedIdSet, ...seenIdSet]));
    const poolTextExclusion = new Set([...excludedTextSet, ...seenTextSet]);
    const doNotRepeatTexts = [...excludedTextSet];

    const buildPayloadFromRetrieved = (retrieved) => {
      let strat = inferEvaluationStrategyForRound(roundType, retrieved.evaluationStrategy);
      const tests = Array.isArray(retrieved.testCases) ? retrieved.testCases : [];
      const dsaMeta = retrieved.metadata?.dsaMetadata || {};
      const sig = String(dsaMeta?.functionSignature || "").trim();
      const bankStrat = toSafeString(retrieved.evaluationStrategy).toLowerCase();
      if (
        roundTypeImpliesCodeExecutionInterview(roundType) &&
        bankStrat !== "sql_execution" &&
        toSafeString(retrieved.questionId) &&
        tests.length > 0 &&
        sig
      ) {
        strat = "code_execution";
      }
      if (strat === "code_execution") {
        if (!toSafeString(retrieved.questionId) || tests.length === 0 || !sig) {
          console.error("[generateQuestion] Retrieved row failed code_execution validation", {
            questionId: retrieved.questionId,
            testCount: tests.length,
            hasSignature: Boolean(sig),
          });
          return {
            generationError: {
              code: "CODE_GRADING_BANK_ROW_INVALID",
              message:
                "A bank coding question was selected but it is missing test cases or a function signature. Please try again or contact support.",
            },
            question: "",
            questionUrl: "",
            expectedAnswerMode: "code",
            expectedPoints: [],
            questionId: "",
            evaluationStrategy: "code_execution",
            supportedCodingLanguages: [],
          };
        }
      }
      return {
        question: retrieved.question,
        questionUrl: toSafeString(retrieved.metadata?.url),
        expectedAnswerMode: normalizeExpectedAnswerMode(
          retrieved.expectedAnswerMode,
          inferAnswerModeFromRoundType(roundType)
        ),
        expectedPoints: normalizeExpectedPoints(retrieved.expectedPoints, {
          roundType,
          expectedAnswerMode: retrieved.expectedAnswerMode,
        }),
        questionId: retrieved.questionId,
        evaluationStrategy: strat,
        supportedCodingLanguages: normalizeSupportedCodingLanguagesForSlot(
          strat,
          retrieved.metadata?.dsaMetadata
        ),
        resolvedCodeTestCases:
          strat === "code_execution" ? cloneSerializable(tests) || [] : undefined,
        resolvedDsaMetadata:
          strat === "code_execution" ? cloneSerializable(dsaMeta) || {} : undefined,
        resolvedTopics: cloneSerializable(
          Array.isArray(retrieved.metadata?.topics) ? retrieved.metadata.topics : []
        ),
        resolvedSubtopics: cloneSerializable(
          Array.isArray(retrieved.metadata?.subtopics) ? retrieved.metadata.subtopics : []
        ),
        resolvedCompanyTags: cloneSerializable(
          Array.isArray(retrieved.metadata?.companyTags) ? retrieved.metadata.companyTags : []
        ),
        resolvedComplexity: cloneSerializable(retrieved.metadata?.complexity) || null,
      };
    };

    const recordSeenForPick = async (payload) => {
      const retrievedToken =
        buildSeenTokenFromQuestionId(payload?.questionId) ||
        buildSeenTokenFromQuestionText(payload?.question);
      if (retrievedToken && !DISABLE_USER_SEEN_DEDUPE) {
        await addToSet(seenQuestionsKey, retrievedToken, USER_SEEN_TTL_SECONDS);
      }
    };

    // Retrieval-first path: if curated question exists, use it.
    const retrieved = await retrieveQuestion({
      company: companyContext?.name || companyContext?.companyName || "",
      roundType,
      difficulty,
      excludedQuestionIds: retrievalExclusions,
    });
    if (retrieved?.question) {
      if (isInterviewQuestionExcluded(retrieved, excludedIdSet, excludedTextSet)) {
        console.log(
          "[generateQuestion] Skipping bank row — already used in this session (text or id)"
        );
      } else {
        console.log("[generateQuestion] Retrieved curated question");
        const bankPayload = buildPayloadFromRetrieved(retrieved);
        if (bankPayload.generationError) {
          return bankPayload;
        }
        await recordSeenForPick(bankPayload);
        return bankPayload;
      }
    }

    if (inferEvaluationStrategyForRound(roundType, "") === "code_execution") {
      console.error("[generateQuestion] code_execution round but no validated bank question", {
        roundType: toSafeString(roundType),
      });
      return {
        generationError: {
          code: "CODE_GRADING_BANK_UNAVAILABLE",
          message:
            "No coding question with test cases is available for this round right now. Please try again in a moment or contact support.",
        },
        question: "",
        questionUrl: "",
        expectedAnswerMode: "code",
        expectedPoints: [],
        questionId: "",
        evaluationStrategy: "code_execution",
        supportedCodingLanguages: [],
      };
    }

    console.log("[generateQuestion] Fallback to LLM generation");

    const hasPreviousAnswer = Boolean(toSafeString(previousAnswer));
    const adaptiveFollowUp = getAdaptiveFollowUp({
      hasPreviousAnswer,
      previousScore,
      previousEvaluation,
      difficulty,
    });

    const condensedHistory = Array.isArray(roundHistory)
      ? roundHistory
          .slice(-3)
          .map((item, index) => ({
            index: index + 1,
            question: truncateText(item?.question, 180),
            answer: truncateText(item?.answer, 220),
            feedback: truncateText(item?.feedback, 180),
            score:
              Number.isFinite(Number(item?.score)) && Number(item?.score) >= 0
                ? Number(item?.score)
                : null,
          }))
      : [];

    const cacheKey = buildQuestionPoolCacheKey({
      companyContext,
      roundType,
      difficulty,
      placementVisitType,
      placementCluster,
      placementYear,
      mergePlacementByType,
    });
    let questionPool = normalizeQuestionPool(await getJSON(cacheKey));
    if (questionPool.length > 0) {
      console.log("[generateQuestion] Cache hit: using Redis pool");
    } else {
      console.log("[generateQuestion] Cache miss: Redis pool not found");
    }
    console.log(`[generateQuestion] Pool size after fetch: ${questionPool.length}`);
    console.log(
      `[generateQuestion] Session+redis text exclusions: ${poolTextExclusion.size} (dedupeEnabled=${!DISABLE_USER_SEEN_DEDUPE})`
    );

    const filterPoolByExclusions = (pool) =>
      (Array.isArray(pool) ? pool : []).filter((item) => {
        const text = normalizeQuestionTextKey(item?.question);
        if (!text) return false;
        return !poolTextExclusion.has(text);
      });

    const refillQuestionPool = async (
      currentPool,
      requestedCount = poolMinSize,
      repeatTextsForPrompt = doNotRepeatTexts
    ) => {
      try {
        const llmRequestCount = singleQuestionHrRound && !hasPreviousAnswer ? 1 : requestedCount;
        console.log(
          `[generateQuestion] Refilling pool... current size=${currentPool.length}, requested=${llmRequestCount}`
        );
        console.log("[generateQuestion] LLM call: generating question pool");
        const messages = buildQuestionPoolPrompt({
          companyContext,
          roundType,
          roundAbout,
          difficulty,
          adaptiveFollowUp,
          hasPreviousAnswer,
          previousQuestion,
          previousAnswer,
          previousFeedback,
          previousScore,
          condensedHistory,
          requestedCount: llmRequestCount,
          singleQuestionHrRound,
          doNotRepeatQuestionTexts: repeatTextsForPrompt,
        });
        const llmText = await callLLM(messages);
        const parsed = parseJSONResponse(llmText);
        const generatedQuestions = parseLLMQuestionEntries(parsed?.questions);
        console.log(
          `[generateQuestion] LLM returned ${generatedQuestions.length} questions`
        );
        let mergedPool = mergeUniqueQuestions(currentPool, generatedQuestions);
        if (mergedPool.length > MAX_POOL_SIZE) {
          console.log(
            `[generateQuestion] Trimming pool from ${mergedPool.length} to max ${MAX_POOL_SIZE}`
          );
          mergedPool = mergedPool.slice(0, MAX_POOL_SIZE);
        }
        if (!mergedPool.length) {
          console.log(
            "[generateQuestion] Refill produced no valid questions, keeping existing pool"
          );
          return normalizeQuestionPool(currentPool);
        }
        console.log(`[generateQuestion] Pool size after refill: ${mergedPool.length}`);
        await setJSON(cacheKey, mergedPool, QUESTION_POOL_TTL_SECONDS);
        return mergedPool;
      } catch (error) {
        console.warn("[generateQuestion] LLM question generation failed:", error?.message || error);
        return normalizeQuestionPool(currentPool);
      }
    };

    if (questionPool.length < poolMinSize) {
      const missingCount = Math.max(1, poolMinSize - questionPool.length);
      const requestedCount = Math.max(poolMinSize, missingCount);
      console.log(
        `[generateQuestion] Pool below minimum (${questionPool.length} < ${poolMinSize}), triggering refill`
      );
      questionPool = await refillQuestionPool(questionPool, requestedCount);
    }

    let availableQuestions = filterPoolByExclusions(questionPool);
    console.log(
      `[generateQuestion] Available unseen questions: ${availableQuestions.length}`
    );

    if (availableQuestions.length === 0) {
      console.log("[generateQuestion] No unseen questions left, refilling pool...");
      questionPool = await refillQuestionPool(questionPool, poolMinSize, doNotRepeatTexts);
      availableQuestions = filterPoolByExclusions(questionPool);
      console.log(
        `[generateQuestion] Available unseen questions after refill: ${availableQuestions.length}`
      );
    }

    let picked = getRandomItem(availableQuestions);

    if (
      picked &&
      isInterviewQuestionExcluded(picked, excludedIdSet, excludedTextSet)
    ) {
      console.warn("[generateQuestion] Picked duplicate from pool — refilling once");
      questionPool = await refillQuestionPool(questionPool, poolMinSize, doNotRepeatTexts);
      availableQuestions = filterPoolByExclusions(questionPool);
      picked = getRandomItem(availableQuestions);
    }

    let selectedQuestion =
      picked && picked.question
        ? {
            question: picked.question,
            expectedAnswerMode: normalizeExpectedAnswerMode(
              picked.expectedAnswerMode,
              inferAnswerModeFromRoundType(roundType)
            ),
            expectedPoints: normalizeExpectedPoints(picked.expectedPoints, {
              roundType,
              expectedAnswerMode: picked.expectedAnswerMode,
            }),
            supportedCodingLanguages: normalizeSupportedCodingLanguagesForSlot(
              toSafeString(picked?.evaluationStrategy),
              picked?.dsaMetadata || {}
            ),
          }
        : buildBasicFallbackQuestion({
            roundType,
            roundAbout,
            difficulty,
          });

    if (
      isInterviewQuestionExcluded(
        { question: selectedQuestion.question, questionId: picked?.questionId },
        excludedIdSet,
        excludedTextSet
      )
    ) {
      console.error("[generateQuestion] Could not produce a new question for this session");
      return {
        generationError: {
          code: "QUESTION_POOL_EXHAUSTED",
          message:
            "No new interview questions are available for this round right now. Try a different plan or add more questions to the bank.",
        },
        question: "",
        questionUrl: "",
        expectedAnswerMode: inferAnswerModeFromRoundType(roundType),
        expectedPoints: [],
        questionId: "",
        evaluationStrategy: inferEvaluationStrategyForRound(roundType, ""),
        supportedCodingLanguages: [],
      };
    }

    if (picked && picked.question) {
      console.log("[generateQuestion] Recording selected question in seen set");
      const seenToken = buildSeenTokenFromQuestionText(picked.question);
      if (seenToken && !DISABLE_USER_SEEN_DEDUPE) {
        await addToSet(seenQuestionsKey, seenToken, USER_SEEN_TTL_SECONDS);
      }
    }

    const inferredStrat = inferEvaluationStrategyForRound(roundType, picked?.evaluationStrategy);
    if (inferredStrat === "code_execution") {
      console.error("[generateQuestion] LLM pool produced code_execution strategy — blocked", {
        roundType: toSafeString(roundType),
      });
      return {
        generationError: {
          code: "CODE_GRADING_BANK_UNAVAILABLE",
          message:
            "Coding rounds require a bank question with test cases. None is available. Please try again or contact support.",
        },
        question: "",
        questionUrl: "",
        expectedAnswerMode: "code",
        expectedPoints: [],
        questionId: "",
        evaluationStrategy: "code_execution",
        supportedCodingLanguages: [],
      };
    }
    const normalizedLangs = normalizeSupportedCodingLanguagesForSlot(
      inferredStrat,
      picked?.dsaMetadata || {}
    );
    const slotLangs = Array.isArray(selectedQuestion.supportedCodingLanguages)
      ? selectedQuestion.supportedCodingLanguages
      : [];
    return {
      question: selectedQuestion.question,
      questionUrl: toSafeString(picked?.url),
      expectedAnswerMode: normalizeExpectedAnswerMode(
        selectedQuestion.expectedAnswerMode,
        inferAnswerModeFromRoundType(roundType)
      ),
      expectedPoints: normalizeExpectedPoints(selectedQuestion.expectedPoints, {
        roundType,
        expectedAnswerMode: selectedQuestion.expectedAnswerMode,
      }),
      questionId: toSafeString(picked?.questionId),
      evaluationStrategy: inferredStrat,
      supportedCodingLanguages: slotLangs.length > 0 ? slotLangs : normalizedLangs,
    };
  } catch (error) {
    console.warn(
      "[generateQuestion] Unexpected failure, returning basic fallback question:",
      error?.message || error
    );
    if (inferEvaluationStrategyForRound(roundType, "") === "code_execution") {
      return {
        generationError: {
          code: "CODE_GRADING_BANK_UNAVAILABLE",
          message:
            "Could not load a coding question for this round. Please try again or contact support.",
        },
        question: "",
        questionUrl: "",
        expectedAnswerMode: "code",
        expectedPoints: [],
        questionId: "",
        evaluationStrategy: "code_execution",
        supportedCodingLanguages: [],
      };
    }
    const fallback = buildBasicFallbackQuestion({
      roundType,
      roundAbout,
      difficulty,
    });
    if (
      isInterviewQuestionExcluded(
        { question: fallback.question, questionId: "" },
        excludedIdSet,
        excludedTextSet
      )
    ) {
      return {
        generationError: {
          code: "QUESTION_POOL_EXHAUSTED",
          message:
            "No new interview questions are available for this round right now. Try a different plan or add more questions to the bank.",
        },
        question: "",
        questionUrl: "",
        expectedAnswerMode: inferAnswerModeFromRoundType(roundType),
        expectedPoints: [],
        questionId: "",
        evaluationStrategy: inferEvaluationStrategyForRound(roundType, ""),
        supportedCodingLanguages: [],
      };
    }
    return fallback;
  }
};

export default generateQuestion;