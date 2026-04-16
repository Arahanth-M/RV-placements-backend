import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";
import { addToSet, getJSON, getSetMembers, setJSON } from "../../src/utils/redisHelpers.js";

const MIN_POOL_SIZE = 5;
const MAX_POOL_SIZE = 10;
const QUESTION_POOL_TTL_SECONDS = 60 * 60;
const USER_SEEN_TTL_SECONDS = 24 * 60 * 60;

const toSafeString = (value, fallback = "") => {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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

const buildQuestionPoolCacheKey = ({ companyContext, roundType, difficulty }) => {
  const company = normalizeCacheToken(
    companyContext?.name || companyContext?.companyName,
    "unknown_company"
  );
  const type = normalizeCacheToken(roundType, "general");
  const level = normalizeDifficulty(difficulty);
  return `${company}:${type}:${level}`;
};

const buildSeenQuestionsKey = (userId) => {
  const normalizedUserId = normalizeCacheToken(userId, "anonymous");
  return `user:${normalizedUserId}:seen_questions`;
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
    };
  }
  const question = toSafeString(item);
  if (!question) return null;
  return { question, expectedAnswerMode: "conceptual", expectedPoints: [] };
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
}) => {
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

Has previous answer in this round: ${hasPreviousAnswer ? "yes" : "no"}
Previous question: ${truncateText(previousQuestion, 220)}
Previous answer: ${truncateText(previousAnswer, 320)}
Previous feedback: ${truncateText(previousFeedback, 220)}
Previous score: ${
        Number.isFinite(Number(previousScore)) ? Number(previousScore) : "N/A"
      }

Recent round history: ${JSON.stringify(condensedHistory)}

Rules:
1) Speak like a real interviewer, not like a question generator.
2) Use natural conversational phrasing (e.g., "Can you walk me through...", "What would happen if...", "How would you approach...").
3) If previous answer exists, each question should feel like a continuation of the conversation.
4) If previous feedback highlights a gap or mistake, include follow-up questions that target that gap.
5) Avoid robotic phrasing like "Explain..." or "Describe...".
6) Keep each question concise (1-2 sentences max).
7) Do NOT include explanations, only what the interviewer would say.
8) Respect target difficulty and follow-up mode.
9) Avoid repeating the same question or asking something unrelated.
10) Return exactly ${requestedCount} questions.
11) For each question, include 4-6 rubric points a strong answer should cover.
12) Each rubric point must include:
   - text
   - category
   - importance ("mustHave" | "goodToHave" | "redFlag")
13) Set expectedAnswerMode to one of: "code", "design", "story", "conceptual".
14) Use category values that help grading, such as:
   - coding: "algorithmChoice", "edgeCases", "complexityAwareness", "implementationQuality"
   - system design: "architectureCoverage", "tradeoffs", "scalability", "failureHandling"
   - behavioral: "situationClarity", "actionOwnership", "resultSpecificity", "reflection"
   - general: "coverage", "reasoning", "communication"

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
  } else {
    question = `Can you walk me through your approach to solving a ${level} ${safeTopic} problem, including edge cases?`;
  }

  return {
    question,
    expectedAnswerMode: inferAnswerModeFromRoundType(roundType),
    expectedPoints: buildFallbackRubric({ roundType, roundAbout }),
  };
};

const getAdaptiveFollowUp = ({
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
    ? previousEvaluation.criticalMisses.filter(Boolean)
    : [];
  const lowConfidence = Number.isFinite(priorConfidence) && priorConfidence < 0.55;

  if (!hasPreviousAnswer || !Number.isFinite(smoothedScore)) {
    return {
      targetDifficulty: baseDifficulty,
      followUpMode: "opening",
      interviewerIntent: "Ask a strong opening question for this round.",
    };
  }

  if (criticalMisses.length >= 2) {
    return {
      targetDifficulty: baseDifficulty === "hard" ? "medium" : "easy",
      followUpMode: "repair",
      interviewerIntent:
        "Candidate missed important rubric points. Ask a targeted follow-up that repairs conceptual gaps before moving ahead.",
    };
  }

  if (lowConfidence) {
    return {
      targetDifficulty: baseDifficulty,
      followUpMode: "steady",
      interviewerIntent:
        "Confidence in the previous score is limited. Ask a nearby follow-up at similar difficulty to confirm the candidate's level.",
    };
  }

  if (smoothedScore >= 8) {
    return {
      targetDifficulty: baseDifficulty === "easy" ? "medium" : "hard",
      followUpMode: "challenge",
      interviewerIntent:
        "Candidate did well. Ask a tougher follow-up with deeper reasoning, edge cases, optimization, or trade-off analysis.",
    };
  }

  if (smoothedScore <= 4.5) {
    return {
      targetDifficulty: baseDifficulty === "hard" ? "medium" : "easy",
      followUpMode: "clarify",
      interviewerIntent:
        "Candidate struggled. Ask a clarifying/foundational follow-up that checks core understanding before moving harder.",
    };
  }

  return {
    targetDifficulty: baseDifficulty,
    followUpMode: "steady",
    interviewerIntent:
      "Candidate is average. Ask a related follow-up at similar difficulty to test consistency and practical application.",
  };
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
}) => {
  try {
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
    });
    const seenQuestionsKey = buildSeenQuestionsKey(userId);

    let questionPool = normalizeQuestionPool(await getJSON(cacheKey));
    const seenQuestionTexts = await getSetMembers(seenQuestionsKey);
    const seenLookup = new Set(
      seenQuestionTexts.map((q) => toSafeString(q).toLowerCase()).filter(Boolean)
    );
    if (questionPool.length > 0) {
      console.log("[generateQuestion] Cache hit: using Redis pool");
    } else {
      console.log("[generateQuestion] Cache miss: Redis pool not found");
    }
    console.log(`[generateQuestion] Pool size after fetch: ${questionPool.length}`);
    console.log(`[generateQuestion] Seen questions count: ${seenLookup.size}`);

    const refillQuestionPool = async (currentPool, requestedCount = MIN_POOL_SIZE) => {
      try {
        console.log(
          `[generateQuestion] Refilling pool... current size=${currentPool.length}, requested=${requestedCount}`
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
          requestedCount,
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

    if (questionPool.length < MIN_POOL_SIZE) {
      const missingCount = Math.max(1, MIN_POOL_SIZE - questionPool.length);
      const requestedCount = Math.max(MIN_POOL_SIZE, missingCount);
      console.log(
        `[generateQuestion] Pool below minimum (${questionPool.length} < ${MIN_POOL_SIZE}), triggering refill`
      );
      questionPool = await refillQuestionPool(questionPool, requestedCount);
    }

    let availableQuestions = questionPool.filter(
      (item) => !seenLookup.has(item.question.toLowerCase())
    );
    console.log(
      `[generateQuestion] Available unseen questions: ${availableQuestions.length}`
    );

    if (availableQuestions.length === 0) {
      console.log("[generateQuestion] No unseen questions left, refilling pool...");
      questionPool = await refillQuestionPool(questionPool, MIN_POOL_SIZE);
      availableQuestions = questionPool.filter(
        (item) => !seenLookup.has(item.question.toLowerCase())
      );
      console.log(
        `[generateQuestion] Available unseen questions after refill: ${availableQuestions.length}`
      );
    }

    const picked = getRandomItem(availableQuestions);
    const selectedQuestion =
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
          }
        : buildBasicFallbackQuestion({
            roundType,
            roundAbout,
            difficulty,
          });

    if (picked && picked.question) {
      console.log("[generateQuestion] Recording selected question in seen set");
      await addToSet(seenQuestionsKey, picked.question, USER_SEEN_TTL_SECONDS);
    }

    return {
      question: selectedQuestion.question,
      expectedAnswerMode: normalizeExpectedAnswerMode(
        selectedQuestion.expectedAnswerMode,
        inferAnswerModeFromRoundType(roundType)
      ),
      expectedPoints: normalizeExpectedPoints(selectedQuestion.expectedPoints, {
        roundType,
        expectedAnswerMode: selectedQuestion.expectedAnswerMode,
      }),
    };
  } catch (error) {
    console.warn(
      "[generateQuestion] Unexpected failure, returning basic fallback question:",
      error?.message || error
    );
    return buildBasicFallbackQuestion({
      roundType,
      roundAbout,
      difficulty,
    });
  }
};

export default generateQuestion;