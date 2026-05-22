import {
  resolveInterviewMergedCompanyForSession,
} from "./interviewSessionService.js";
import {
  resolvedQuestionAnswer,
  resolvedQuestionScore,
  questionSlotHasInterviewPayload,
} from "../utils/interviewQuestionAttempts.js";
import { getCompanyContext } from "./mcp/getCompanyContext.js";
import { generateFinalFeedback } from "./mcp/generateFinalFeedback.js";
import { INTERVIEW_STATES } from "./interviewStateMachine.js";
import { logInterviewDsaLlmDebug, tailId } from "./interviewDebugLog.js";
import {
  getRoundPreviewLabel,
  normalizeCustomRoundFocus,
  resolveRoundAbout,
} from "../config/interviewRoundFocus.js";

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

export const inferQuestionCount = (roundType) => {
  if (roundType === "DSA") return 3;
  if (roundType === "SQL") return 4;
  if (roundType === "System Design") return 3;
  if (roundType === "HR") return 1;
  if (roundType === "CS Fundamentals") return 3;
  return 3;
};

/** Clamp stored/planned question count for a round type (HR min 1, SQL max 4, etc.). */
export const clampQuestionCountForRound = (roundType, questionCount, slots = 0) => {
  const planned = inferQuestionCount(roundType || "");
  let count =
    typeof questionCount === "number" && Number.isFinite(questionCount)
      ? Math.round(questionCount)
      : null;
  if (count == null || count < 1) {
    count = Math.max(slots, planned);
  }
  count = Math.min(planned, Math.max(1, count));
  if (roundType === "DSA") {
    count = Math.min(3, count);
  }
  return count;
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

  const normalized = rounds.map((round, index) => {
    const type = normalizeCustomRoundType(round?.type);
    const focus =
      type === "DSA"
        ? ""
        : round?.focus != null
          ? normalizeCustomRoundFocus(type, round.focus)
          : round?.about != null
            ? normalizeCustomRoundFocus(type, round.about)
            : normalizeCustomRoundFocus(type, "");
    return {
      roundNumber: index + 1,
      type,
      difficulty: normalizeCustomRoundDifficulty(round?.difficulty),
      ...(focus ? { focus } : {}),
      about: resolveRoundAbout(type, focus),
    };
  });

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
    about: round.about,
    difficulty: round.difficulty,
    questionCount: inferQuestionCount(round.type),
    questions: [],
    feedback: {},
    status: index === 0 ? "IN_PROGRESS" : "COMPLETED",
  }));

  return {
    rounds,
    roundsPlan: rounds.map((round) => `${getRoundPreviewLabel(round.type)} — ${round.about}`),
    roundsDetails: rounds.map((round) => ({
      round: `Round ${round.roundNumber}`,
      questionType: round.about,
    })),
    totalRounds: rounds.length,
    currentRound: 1,
    state: INTERVIEW_STATES.IN_PROGRESS,
  };
};

/**
 * Final interview report (natural-language summary via LLM).
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
    const readinessScore = Math.max(0, Math.min(100, Math.round(boundedOverall * 10)));
    const verdict =
      boundedOverall > 8 ? "ready" : boundedOverall >= 6 ? "needs_improvement" : "not_ready";
    return {
      overallScore: boundedOverall,
      readinessScore,
      readinessLabel:
        verdict === "ready"
          ? "Ready"
          : verdict === "not_ready"
            ? "Not ready"
            : "Needs improvement",
      verdict,
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

  const roundTypesInTranscript = [
    ...new Set(transcriptRows.map((row) => toSafeString(row.roundType, "(empty)"))),
  ];
  logInterviewDsaLlmDebug("final_report_llm_invoke", {
    sessionIdTail: tailId(session?._id),
    transcriptRowCount: transcriptRows.length,
    roundTypesInTranscript,
    avgScoreComputed: boundedOverall,
  });

  const finalFeedback = await generateFinalFeedback({
    transcript: transcriptRows,
    companyContext,
  });

  const strengths = normalizeStringArray(finalFeedback?.strengths);
  const weaknesses = normalizeStringArray(finalFeedback?.weaknesses);

  const verdictRaw = toSafeString(finalFeedback?.verdict).toLowerCase();
  const verdict =
    verdictRaw === "ready" || verdictRaw === "not_ready" || verdictRaw === "needs_improvement"
      ? verdictRaw
      : boundedOverall > 8
        ? "ready"
        : boundedOverall >= 6
          ? "needs_improvement"
          : "not_ready";

  const readinessScore = Math.max(0, Math.min(100, Math.round(boundedOverall * 10)));
  const readinessLabel =
    verdict === "ready"
      ? "Ready"
      : verdict === "not_ready"
        ? "Not ready"
        : "Needs improvement";

  return {
    overallScore: boundedOverall,
    readinessScore,
    readinessLabel,
    verdict,
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

