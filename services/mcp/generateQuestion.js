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

const normalizeQuestionPool = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toSafeString(item)).filter(Boolean);
};

const mergeUniqueQuestions = (...questionLists) => {
  const merged = [];
  const seen = new Set();

  questionLists
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .forEach((item) => {
      const safe = toSafeString(item);
      if (!safe) return;
      const normalized = safe.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      merged.push(safe);
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

Return JSON:
{
  "questions": ["string", "string", "..."]
}`,
    },
  ];
};

const getRandomItem = (array) => {
  if (!Array.isArray(array) || array.length === 0) return "";
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex] || "";
};

const buildBasicFallbackQuestion = ({ roundType, roundAbout, difficulty }) => {
  const safeRoundType = toSafeString(roundType, "technical").toLowerCase();
  const safeTopic = toSafeString(roundAbout, "this topic");
  const level = normalizeDifficulty(difficulty);

  if (safeRoundType.includes("hr") || safeRoundType.includes("behavior")) {
    return `Can you share a situation where you handled a challenge related to ${safeTopic}, and what result you achieved?`;
  }

  if (safeRoundType.includes("system")) {
    return `How would you design a ${safeTopic} system at ${level} difficulty, and what trade-offs would you consider first?`;
  }

  return `Can you walk me through your approach to solving a ${level} ${safeTopic} problem, including edge cases?`;
};

const getAdaptiveFollowUp = ({ hasPreviousAnswer, previousScore, difficulty }) => {
  const baseDifficulty = normalizeDifficulty(difficulty);
  const score = Number(previousScore);

  if (!hasPreviousAnswer || !Number.isFinite(score)) {
    return {
      targetDifficulty: baseDifficulty,
      followUpMode: "opening",
      interviewerIntent: "Ask a strong opening question for this round.",
    };
  }

  if (score >= 8) {
    return {
      targetDifficulty: baseDifficulty === "easy" ? "medium" : "hard",
      followUpMode: "challenge",
      interviewerIntent:
        "Candidate did well. Ask a tougher follow-up with deeper reasoning, edge cases, optimization, or trade-off analysis.",
    };
  }

  if (score <= 4) {
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
 * Generates one interview question for the given round context.
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
  roundHistory = [],
}) => {
  try {
    const hasPreviousAnswer = Boolean(toSafeString(previousAnswer));
    const adaptiveFollowUp = getAdaptiveFollowUp({
      hasPreviousAnswer,
      previousScore,
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

    let questionPool = [];
    let seenLookup = new Set();
    try {
      questionPool = normalizeQuestionPool(await getJSON(cacheKey));
      const seenQuestions = normalizeQuestionPool(await getSetMembers(seenQuestionsKey));
      seenLookup = new Set(seenQuestions.map((question) => question.toLowerCase()));
      if (questionPool.length > 0) {
        console.log("[generateQuestion] Cache hit: using Redis pool");
      } else {
        console.log("[generateQuestion] Cache miss: Redis pool not found");
      }
      console.log(`[generateQuestion] Pool size after fetch: ${questionPool.length}`);
      console.log(`[generateQuestion] Seen questions count: ${seenLookup.size}`);
    } catch (error) {
      // If Redis read path fails, continue with direct LLM refill path.
      console.warn("[generateQuestion] Redis read failed, falling back to LLM:", error?.message || error);
      questionPool = [];
      seenLookup = new Set();
    }

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
        const generatedQuestions = normalizeQuestionPool(parsed?.questions);
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
        try {
          await setJSON(cacheKey, mergedPool, QUESTION_POOL_TTL_SECONDS);
        } catch (error) {
          console.warn("[generateQuestion] Redis write failed for pool cache:", error?.message || error);
        }
        return mergedPool;
      } catch (error) {
        // If LLM fails, keep existing pool (if any) and let caller use static fallback.
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
      (question) => !seenLookup.has(question.toLowerCase())
    );
    console.log(
      `[generateQuestion] Available unseen questions: ${availableQuestions.length}`
    );

    if (availableQuestions.length === 0) {
      console.log("[generateQuestion] No unseen questions left, refilling pool...");
      questionPool = await refillQuestionPool(questionPool, MIN_POOL_SIZE);
      availableQuestions = questionPool.filter(
        (question) => !seenLookup.has(question.toLowerCase())
      );
      console.log(
        `[generateQuestion] Available unseen questions after refill: ${availableQuestions.length}`
      );
    }

    const selectedQuestion = toSafeString(getRandomItem(availableQuestions));
    const question =
      selectedQuestion ||
      buildBasicFallbackQuestion({
        roundType,
        roundAbout,
        difficulty,
      });

    try {
      if (selectedQuestion) {
        console.log("[generateQuestion] Recording selected question in seen set");
        await addToSet(seenQuestionsKey, selectedQuestion, USER_SEEN_TTL_SECONDS);
      }
    } catch (error) {
      console.warn("[generateQuestion] Redis write failed for seen questions:", error?.message || error);
    }

    return question;
  } catch (error) {
    console.warn("[generateQuestion] Unexpected failure, returning basic fallback question:", error?.message || error);
    return buildBasicFallbackQuestion({
      roundType,
      roundAbout,
      difficulty,
    });
  }
};

export default generateQuestion;