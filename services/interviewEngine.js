import { callLLM } from "./llmClient.js";
import { parseJSONResponse } from "../utils/parseJSONResponse.js";
import {
  resolveInterviewMergedCompanyForSession,
} from "./interviewSessionService.js";
import {
  resolvedQuestionAnswer,
  resolvedQuestionScore,
  questionSlotHasInterviewPayload,
} from "../utils/interviewQuestionAttempts.js";
import { getCompanyContext } from "./mcp/getCompanyContext.js";
import { getNumberOfRounds } from "./mcp/getNumberOfRounds.js";
import { generateFinalFeedback } from "./mcp/generateFinalFeedback.js";
import { INTERVIEW_STATES } from "./interviewStateMachine.js";
import {
  buildInterviewRoundEvidence,
  classifyRoundTypeFromHint,
  constrainRoundType,
  normalizePlannerRoundType,
} from "./interviewRoundInference.js";

const toSafeString = (value, fallback = "") => {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

export const INTERVIEW_MAX_ROUNDS = 4;
export const INTERVIEW_ALLOWED_ROUND_TYPES = [
  "DSA",
  "System Design",
  "SQL",
  "CS Fundamentals",
  "HR",
];
const INTERVIEW_ALLOWED_DIFFICULTIES = ["easy", "medium", "hard"];

function inferRoundAbout(roundType) {
  if (!roundType) {
    return "General Technical";
  }

  const normalized = toSafeString(roundType)
    .toUpperCase()
    .replace(/\s+/g, "_");

  const mapping = {
    DSA: "Data Structures and Algorithms",
    SYSTEM_DESIGN: "System Design",
    HR: "Behavioral and HR",
  };

  return mapping[normalized] || "General Technical";
}

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

const inferDifficulty = (text) => {
  const value = toSafeString(text).toLowerCase();
  if (value.includes("hard") || value.includes("advanced")) return "hard";
  if (value.includes("easy") || value.includes("basic")) return "easy";
  return "medium";
};

const inferQuestionCount = (roundType) => {
  if (roundType === "DSA") return 4;
  if (roundType === "SQL") return 4;
  if (roundType === "System Design") return 3;
  return 3;
};

const getRoundPreviewLabel = (roundType) => {
  if (roundType === "System Design") return "System Design Round";
  if (roundType === "SQL") return "SQL Round";
  if (roundType === "CS Fundamentals") return "CS Fundamentals Round";
  if (roundType === "HR") return "HR/Behavioral Round";
  return "DSA/Coding Round";
};

const normalizeCustomRoundType = (value) => {
  const safe = toSafeString(value);
  return INTERVIEW_ALLOWED_ROUND_TYPES.includes(safe) ? safe : "DSA";
};

const normalizeCustomRoundDifficulty = (value) => {
  const safe = toSafeString(value).toLowerCase();
  return INTERVIEW_ALLOWED_DIFFICULTIES.includes(safe) ? safe : "medium";
};

const validateCustomRoundPlan = (rounds) => {
  if (!Array.isArray(rounds) || rounds.length === 0) {
    throw new Error("Custom interview plan must include at least one round.");
  }
  if (rounds.length > INTERVIEW_MAX_ROUNDS) {
    throw new Error(`Custom interview plan cannot exceed ${INTERVIEW_MAX_ROUNDS} rounds.`);
  }

  const normalized = rounds.map((round, index) => ({
    roundNumber: index + 1,
    type: normalizeCustomRoundType(round?.type),
    difficulty: normalizeCustomRoundDifficulty(round?.difficulty),
  }));

  const hrCount = normalized.filter((round) => round.type === "HR").length;
  if (hrCount < 1) {
    throw new Error("At least one HR round is required in the interview plan.");
  }

  const hardSystemDesignCount = normalized.filter(
    (round) => round.type === "System Design" && round.difficulty === "hard"
  ).length;
  if (hardSystemDesignCount > 2) {
    throw new Error("Too many hard System Design rounds. Use at most 2 hard System Design rounds.");
  }

  return normalized;
};

export const generateInterviewPlanFromCustomRounds = async (customRounds = []) => {
  const normalizedRounds = validateCustomRoundPlan(customRounds);
  const rounds = normalizedRounds.map((round, index) => ({
    roundNumber: round.roundNumber,
    type: round.type,
    about: getRoundPreviewLabel(round.type),
    difficulty: round.difficulty,
    questionCount: inferQuestionCount(round.type),
    questions: [],
    feedback: {},
    status: index === 0 ? "IN_PROGRESS" : "COMPLETED",
  }));

  return {
    rounds,
    roundsPlan: rounds.map((round) => getRoundPreviewLabel(round.type)),
    roundsDetails: rounds.map((round) => ({
      round: `Round ${round.roundNumber}`,
      questionType: getRoundPreviewLabel(round.type),
    })),
    totalRounds: rounds.length,
    currentRound: 1,
    state: INTERVIEW_STATES.IN_PROGRESS,
  };
};

const buildFallbackBlueprint = (companyContext, totalRounds, roundHints = [], evidence) => {
  const hints = Array.isArray(roundHints) ? roundHints : [];
  return Array.from({ length: totalRounds }, (_, index) => {
    const seedText = hints[index]?.about || companyContext?.rounds?.[index] || `Round ${index + 1}`;
    const roundType = classifyRoundTypeFromHint(seedText, evidence || {});
    return {
      roundNumber: index + 1,
      type: roundType,
      about: sanitizeRoundAbout(
        seedText || inferRoundAbout(roundType),
        inferRoundAbout(roundType)
      ),
      difficulty: inferDifficulty(seedText),
      questionCount: inferQuestionCount(roundType),
    };
  });
};

const buildAiRoundBlueprint = async ({ companyContext, totalRounds, roundHints, evidence }) => {
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
  inferenceSignals: evidence
    ? {
        systemDesignMentionedInCorpus: Boolean(evidence.systemDesignAllowed),
        hrThemesLikely: Boolean(evidence.hrHits >= 1),
      }
    : {},
})}

Rules:
1) Align round order and themes with roundHints (from interviewProcess). Each round's type must fit what that hint describes.
2) Map unclear technical rounds to DSA unless hints or interviewQuestions clearly indicate system/HLD design (see inferenceSignals.systemDesignMentionedInCorpus).
3) Do NOT assign System Design to any round unless systemDesignMentionedInCorpus is true OR that round's hint explicitly mentions system design / HLD / distributed architecture / designing a scalable service.
4) Prefer HR only when the hint suggests behavioral, HR, managerial, or culture-fit — not for purely coding rounds.
5) Each round must include one short about line (max 10 words preferred).
6) type must be exactly one of: DSA, System Design, HR (use those spellings).
7) difficulty must be one of: easy, medium, hard.
8) questionCount must be an integer between 3 and 5.

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
  const evidence = buildInterviewRoundEvidence(companyData);
  const { totalRounds: computedTotalRounds, roundHints } = await getNumberOfRounds(companyData);
  const totalRounds = Math.min(
    INTERVIEW_MAX_ROUNDS,
    Math.max(1, Number(computedTotalRounds) || 3)
  );

  const fallbackBlueprint = buildFallbackBlueprint(companyContext, totalRounds, roundHints, evidence);
  let aiBlueprint = [];
  try {
    aiBlueprint = await buildAiRoundBlueprint({
      companyContext,
      totalRounds,
      roundHints,
      evidence,
    });
  } catch (error) {
    console.warn("AI round planning failed, using fallback blueprint:", error?.message || error);
    aiBlueprint = [];
  }

  const hints = Array.isArray(roundHints) ? roundHints : [];
  const rounds = Array.from({ length: totalRounds }, (_, index) => {
    const aiRound = aiBlueprint[index] || {};
    const fallbackRound = fallbackBlueprint[index] || {
      roundNumber: index + 1,
      type: "DSA",
      about: "General Interview",
      difficulty: "medium",
      questionCount: 3,
    };

    const seedHint =
      hints[index]?.about ||
      companyContext?.rounds?.[index] ||
      fallbackRound.about ||
      `Round ${index + 1}`;
    const aiTypeRaw = aiRound.type != null && aiRound.type !== "" ? normalizePlannerRoundType(aiRound.type) : "";
    const candidateType = aiTypeRaw || fallbackRound.type;
    const type = constrainRoundType(candidateType, seedHint, evidence, fallbackRound.type);
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
    state: INTERVIEW_STATES.IN_PROGRESS,
  };
};

/**
 * LLM is used only for natural-language report generation.
 */
export const generateFinalReport = async (session) => {
  if (!session) {
    throw new Error("generateFinalReport requires a valid session object.");
  }

  const transcriptRows = (Array.isArray(session?.rounds) ? session.rounds : []).flatMap(
    (round) => {
      const questions = Array.isArray(round?.questions) ? round.questions : [];
      return questions
        .filter((q) => questionSlotHasInterviewPayload(q))
        .map((question) => {
          const answerText = resolvedQuestionAnswer(question);
          const scoreVal = resolvedQuestionScore(question);
          return {
            roundNumber: round?.roundNumber,
            roundType: round?.type,
            difficulty: round?.difficulty,
            question: question?.question || "",
            answer:
              answerText ||
              (scoreVal != null && Number.isFinite(scoreVal)
                ? "(Graded response; answer text unavailable in storage)"
                : ""),
            score: scoreVal,
            feedback: typeof question?.feedback === "string" ? question.feedback : "",
          };
        });
    }
  );

  const numericScores = transcriptRows
    .map((row) => Number(row.score))
    .filter((s) => Number.isFinite(s));

  let avgScore =
    numericScores.length > 0
      ? numericScores.reduce((sum, s) => sum + s, 0) / numericScores.length
      : 0;

  if (!(avgScore > 0) && numericScores.length === 0) {
    const rounds = Array.isArray(session?.rounds) ? session.rounds : [];
    const roundScores = rounds
      .map((r) => Number(r?.feedback?.score))
      .filter((x) => Number.isFinite(x));
    if (roundScores.length > 0) {
      avgScore = roundScores.reduce((sum, s) => sum + s, 0) / roundScores.length;
    }
  }

  const boundedOverall = Math.round(toBoundedScore(avgScore) * 10) / 10;

  const emptyReportShell = () => ({
    strengths: [],
    weaknesses: [],
    improvementPlan: [],
    overallStrength: "",
    overallWeakness: "",
    summaryFeedback: "",
    companyRoadmap: [],
  });

  if (transcriptRows.length === 0) {
    return {
      overallScore: boundedOverall,
      ...emptyReportShell(),
      summaryFeedback:
        boundedOverall > 0
          ? `Interview complete. Overall score ${boundedOverall}/10 is derived from round summaries (per-question transcript was not available).`
          : "",
    };
  }

  let companyContext = {};
  try {
    const cid = session?.companyId;
    if (cid) {
      const companyData = await resolveInterviewMergedCompanyForSession(session);
      companyContext = await getCompanyContext(companyData || {});
    }
  } catch (err) {
    console.warn("[generateFinalReport] company context failed:", err?.message || err);
  }

  const finalFeedback = await generateFinalFeedback({
    transcript: transcriptRows,
    companyContext,
  });

  const strengths = normalizeStringArray(finalFeedback?.strengths);
  const weaknesses = normalizeStringArray(finalFeedback?.weaknesses);

  return {
    overallScore: boundedOverall,
    strengths,
    weaknesses,
    improvementPlan: normalizeStringArray(finalFeedback?.improvementPlan),
    overallStrength: toSafeString(
      finalFeedback?.overallStrength || finalFeedback?.strongestArea || strengths[0]
    ),
    overallWeakness: toSafeString(
      finalFeedback?.overallWeakness || finalFeedback?.weakestArea || weaknesses[0]
    ),
    summaryFeedback: toSafeString(finalFeedback?.summaryFeedback),
    companyRoadmap: normalizeStringArray(finalFeedback?.companyRoadmap),
  };
};

