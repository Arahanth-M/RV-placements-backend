import { callLLM } from "./llmClient.js";
import { parseJSONResponse } from "../utils/parseJSONResponse.js";
import { getCompanyContext } from "./mcp/getCompanyContext.js";
import { getNumberOfRounds } from "./mcp/getNumberOfRounds.js";
import { generateFinalFeedback } from "./mcp/generateFinalFeedback.js";

const toSafeString = (value, fallback = "") => {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        return toSafeString(item.question || item.content || item.title);
      }
      return "";
    })
    .filter(Boolean);
};

const toBoundedScore = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(10, numeric));
};

const normalizeRoundType = (value) => {
  const safe = toSafeString(value).toLowerCase();
  if (safe.includes("system")) return "System Design";
  if (safe.includes("hr") || safe.includes("behavior")) return "HR";
  return "DSA";
};

const normalizeDifficultyValue = (value) => {
  const safe = toSafeString(value).toLowerCase();
  if (safe === "easy" || safe === "medium" || safe === "hard") return safe;
  if (safe.includes("easy") || safe.includes("basic")) return "easy";
  if (safe.includes("hard") || safe.includes("advanced")) return "hard";
  return "medium";
};

const sanitizeRoundAbout = (value, fallbackText) => {
  const raw = toSafeString(value);
  if (!raw) return fallbackText;

  const cleaned = raw
    .replace(/^round\s*\d+\s*[:\-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallbackText;

  let oneLine = cleaned.split(/[;|.]/)[0].trim() || cleaned;
  const words = oneLine.split(" ").filter(Boolean);
  if (words.length > 12) {
    oneLine = `${words.slice(0, 12).join(" ")}...`;
  }
  if (oneLine.length > 80) {
    oneLine = `${oneLine.slice(0, 77).trimEnd()}...`;
  }
  return oneLine || fallbackText;
};

const clampQuestionCount = (value, fallbackCount) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallbackCount;
  return Math.min(5, Math.max(3, Math.round(n)));
};

const inferRoundType = (text) => {
  const value = toSafeString(text).toLowerCase();
  if (value.includes("system design") || value.includes("design") || value.includes("architecture")) {
    return "System Design";
  }
  if (value.includes("hr") || value.includes("behavior") || value.includes("managerial")) {
    return "HR";
  }
  return "DSA";
};

const inferDifficulty = (text) => {
  const value = toSafeString(text).toLowerCase();
  if (value.includes("hard") || value.includes("advanced")) return "hard";
  if (value.includes("easy") || value.includes("basic")) return "easy";
  return "medium";
};

const inferQuestionCount = (roundType) => {
  if (roundType === "DSA") return 4;
  if (roundType === "System Design") return 3;
  return 3;
};

const getRoundPreviewLabel = (roundType) => {
  if (roundType === "System Design") return "System Design Round";
  if (roundType === "HR") return "HR/Behavioral Round";
  return "DSA/Coding Round";
};

const buildFallbackBlueprint = (companyContext, totalRounds, roundHints = []) => {
  const hints = Array.isArray(roundHints) ? roundHints : [];
  return Array.from({ length: totalRounds }, (_, index) => {
    const seedText = hints[index]?.about || companyContext?.rounds?.[index] || `Round ${index + 1}`;
    const roundType = inferRoundType(seedText);
    return {
      roundNumber: index + 1,
      type: roundType,
      about: sanitizeRoundAbout(
        seedText || inferRoundAbout(seedText, roundType, index),
        `${roundType} Round`
      ),
      difficulty: inferDifficulty(seedText),
      questionCount: inferQuestionCount(roundType),
    };
  });
};

const buildAiRoundBlueprint = async ({ companyContext, totalRounds, roundHints }) => {
  const messages = [
    {
      role: "system",
      content:
        "You are an interview planner. Decide round structure using company context. Return strict JSON only. No markdown or explanation.",
    },
    {
      role: "user",
      content: `Plan exactly ${totalRounds} interview rounds.

Input context JSON:
${JSON.stringify({
  companyName: companyContext?.name,
  rounds: companyContext?.rounds || [],
  onlineQuestions: companyContext?.onlineQuestions || [],
  interviewQuestions: companyContext?.interviewQuestions || [],
  mustDoTopics: companyContext?.mustDoTopics || [],
  prevCodingQuestions: companyContext?.prevCodingQuestions || [],
  roundHints: Array.isArray(roundHints) ? roundHints : [],
})}

Rules:
1) Use interviewProcess as context only; do NOT copy long raw process text.
2) Each round must include one short about line (max 10 words preferred).
3) Keep each about line concise and practical.
4) type must be one of: DSA, System Design, HR.
5) difficulty must be one of: easy, medium, hard.
6) questionCount should be an integer between 3 and 5.

Return JSON:
{
  "rounds": [
    {
      "roundNumber": 1,
      "type": "DSA",
      "about": "Coding and problem solving",
      "difficulty": "medium",
      "questionCount": 4
    }
  ]
}`,
    },
  ];

  const llmText = await callLLM(messages);
  const parsed = parseJSONResponse(llmText);
  return Array.isArray(parsed?.rounds) ? parsed.rounds : [];
};

/**
 * AI-assisted round plan generation.
 * Backend validates/sanitizes structure before using it.
 */
export const generateInterviewPlan = async (companyData) => {
  const companyContext = await getCompanyContext(companyData);
  const { totalRounds: computedTotalRounds, roundHints } = await getNumberOfRounds(companyData);
  const totalRounds = Math.max(1, Number(computedTotalRounds) || 3);

  const fallbackBlueprint = buildFallbackBlueprint(companyContext, totalRounds, roundHints);
  let aiBlueprint = [];
  try {
    aiBlueprint = await buildAiRoundBlueprint({
      companyContext,
      totalRounds,
      roundHints,
    });
  } catch (error) {
    console.warn("AI round planning failed, using fallback blueprint:", error?.message || error);
    aiBlueprint = [];
  }

  const rounds = Array.from({ length: totalRounds }, (_, index) => {
    const aiRound = aiBlueprint[index] || {};
    const fallbackRound = fallbackBlueprint[index] || {
      roundNumber: index + 1,
      type: "DSA",
      about: "General Interview",
      difficulty: "medium",
      questionCount: 3,
    };

    const type = normalizeRoundType(aiRound.type || fallbackRound.type);
    const about = getRoundPreviewLabel(type);
    const difficulty = normalizeDifficultyValue(aiRound.difficulty || fallbackRound.difficulty);
    const questionCount = clampQuestionCount(
      aiRound.questionCount,
      fallbackRound.questionCount || inferQuestionCount(type)
    );

    return {
      roundNumber: index + 1,
      type,
      about,
      difficulty,
      questionCount,
      questions: [],
      feedback: {},
      status: index === 0 ? "IN_PROGRESS" : "COMPLETED",
    };
  });

  const normalizedRounds =
    rounds.length > 0
      ? rounds
      : [
          {
            roundNumber: 1,
            type: "DSA",
            about: "Technical Screening",
            difficulty: "medium",
            questionCount: 3,
            questions: [],
            feedback: {},
            status: "IN_PROGRESS",
          },
        ];

  const roundsPlan = normalizedRounds.map((round) => getRoundPreviewLabel(round.type));
  const roundsDetails = normalizedRounds.map((round) => ({
    round: `Round ${round.roundNumber}`,
    questionType: getRoundPreviewLabel(round.type),
  }));

  return {
    rounds: normalizedRounds,
    roundsPlan,
    roundsDetails,
    totalRounds,
    currentRound: 1,
    interviewStatus: "IN_PROGRESS",
  };
};

/**
 * LLM is used only for natural-language report generation.
 */
export const generateFinalReport = async (session) => {
  if (!session) {
    throw new Error("generateFinalReport requires a valid session object.");
  }

  const allRoundQuestions = (Array.isArray(session?.rounds) ? session.rounds : [])
    .flatMap((round) => {
      const questions = Array.isArray(round?.questions) ? round.questions : [];
      return questions.map((question) => ({
        roundNumber: round?.roundNumber,
        roundType: round?.type,
        difficulty: round?.difficulty,
        question: question?.question || "",
        answer: question?.answer || "",
        score: question?.score,
        feedback: question?.feedback || "",
      }));
    })
    .filter((item) => item.answer);

  if (allRoundQuestions.length === 0) {
    return {
      overallScore: 0,
      strengths: [],
      weaknesses: [],
      improvementPlan: [],
    };
  }

  const avgScore =
    allRoundQuestions
      .map((item) => Number(item.score))
      .filter((score) => Number.isFinite(score))
      .reduce((sum, score, _, arr) => sum + score / arr.length, 0) || 0;

  const finalFeedback = await generateFinalFeedback({
    transcript: allRoundQuestions,
  });

  return {
    overallScore: Math.round(toBoundedScore(avgScore) * 10) / 10,
    strengths: normalizeStringArray(finalFeedback?.strengths),
    weaknesses: normalizeStringArray(finalFeedback?.weaknesses),
    improvementPlan: normalizeStringArray(finalFeedback?.improvementPlan),
  };
};

