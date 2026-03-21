import { callLLM } from "./llmClient.js";
import { parseJSONResponse } from "../utils/parseJSONResponse.js";
import { getCompanyContext } from "./mcp/getCompanyContext.js";

const DEFAULT_ROUNDS_PLAN = ["online_assessment", "technical_interview", "hr_round"];

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

/**
 * Deterministic round plan generation.
 * Backend controls interview flow completely.
 */
export const generateInterviewPlan = async (companyData) => {
  const companyContext = await getCompanyContext(companyData);
  const seedRounds =
    Array.isArray(companyContext?.rounds) && companyContext.rounds.length > 0
      ? companyContext.rounds
      : DEFAULT_ROUNDS_PLAN;

  const rounds = seedRounds.slice(0, 4).map((roundText, index) => {
    const type = inferRoundType(roundText);
    return {
      roundNumber: index + 1,
      type,
      difficulty: inferDifficulty(roundText),
      questionCount: inferQuestionCount(type),
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
            difficulty: "medium",
            questionCount: 3,
            questions: [],
            feedback: {},
            status: "IN_PROGRESS",
          },
        ];

  return {
    rounds: normalizedRounds,
    totalRounds: normalizedRounds.length,
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

  const messages = [
    {
      role: "system",
      content:
        "You are an interview coach. Return strict JSON only. No markdown. No extra text.",
    },
    {
      role: "user",
      content: `Generate detailed interview report:
* strengths
* weaknesses
* improvement plan

Interview transcript JSON: ${JSON.stringify(allRoundQuestions)}

Return JSON:
{
  "strengths": ["string"],
  "weaknesses": ["string"],
  "improvementPlan": ["string"]
}`,
    },
  ];

  const llmText = await callLLM(messages);
  const parsed = parseJSONResponse(llmText);

  return {
    overallScore: Math.round(toBoundedScore(avgScore) * 10) / 10,
    strengths: normalizeStringArray(parsed?.strengths),
    weaknesses: normalizeStringArray(parsed?.weaknesses),
    improvementPlan: normalizeStringArray(parsed?.improvementPlan),
  };
};

