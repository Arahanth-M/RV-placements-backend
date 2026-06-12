import mongoose from "mongoose";
import InterviewSession from "../models/InterviewSession.js";
import CompanyStatic from "../models/CompanyStatic.js";
import InterviewQuestion from "../models/InterviewQuestion.js";
import {
  COMPANY_VISIT_YEAR,
  getCompanyMergedForAdminById,
  getInterviewMergedCompanyPayload,
  normalizePlacementVisitYear,
  normalizeVisitKeyParts,
} from "./companyService.js";
import { getCompanyContext } from "./mcp/getCompanyContext.js";
import { generateQuestion, normalizeExpectedPoints } from "./mcp/generateQuestion.js";
import { collectSessionQuestionExclusions } from "./interviewQuestionExclusions.js";
import { generateRoundFeedback as generateRoundFeedbackMCP } from "./mcp/generateRoundFeedback.js";
import { generateRoundFeedbackLLM } from "./mcp/generateRoundFeedbackLLM.js";
import { roundTypeImpliesCodeExecutionInterview } from "./interviewCodeGradingGuards.js";
import { logInterviewDsaLlmDebug, tailId } from "./interviewDebugLog.js";
import { computeDsaRoundQuestionBuckets } from "../utils/interviewQuestionAttempts.js";
import { buildResolvedFieldsForQuestionSlot } from "../utils/interviewQuestionSlotSnapshot.js";
import { INTERVIEW_STATES } from "./interviewStateMachine.js";
import {
  INTERVIEW_LIMIT_REASON,
  INTERVIEW_LIMIT_REACHED_MESSAGE,
} from "../config/interviewLimits.js";
import {
  getCachedInterviewAnalytics,
  setCachedInterviewAnalytics,
} from "./interviewCache.js";

const updateOptions = {
  new: true,
  runValidators: true,
};

const UNKNOWN_COMPANY_NAME = "Unknown Company";

/** Union of round `about` tokens and bank topics/subtopics for completed coding-style rounds. */
export const collectTopicsForCompletedCodingRound = async (round) => {
  const about = String(round?.about || "").trim();
  const slots = Array.isArray(round?.questions) ? round.questions : [];
  const ids = [...new Set(slots.map((s) => String(s?.questionId || "").trim()).filter(Boolean))];
  const bag = new Set();
  if (about) {
    about
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((x) => bag.add(x));
  }
  if (ids.length === 0) return [...bag];
  const docs = await InterviewQuestion.find({ questionId: { $in: ids } })
    .select({ topics: 1, subtopics: 1 })
    .lean();
  for (const d of docs) {
    for (const t of Array.isArray(d?.topics) ? d.topics : []) {
      const x = String(t || "").trim();
      if (x) bag.add(x);
    }
    for (const t of Array.isArray(d?.subtopics) ? d.subtopics : []) {
      const x = String(t || "").trim();
      if (x) bag.add(x);
    }
  }
  return [...bag];
};

const expectedPointsFromStrings = (points, defaults = {}) =>
  normalizeExpectedPoints(points, defaults);

const toSafeString = (value) =>
  typeof value === "string" ? value.trim() : "";

const getCompanyRefId = (companyRef) => {
  if (!companyRef) return "";
  if (typeof companyRef === "string") return companyRef.trim();
  if (typeof companyRef?._id !== "undefined" && companyRef._id !== null) {
    return String(companyRef._id).trim();
  }
  if (
    typeof companyRef?.toString === "function" &&
    companyRef.toString !== Object.prototype.toString
  ) {
    return String(companyRef).trim();
  }
  return "";
};

const getCompanyRefName = (companyRef) => {
  const directName =
    toSafeString(companyRef?.name) || toSafeString(companyRef?.companyName);
  return directName && directName !== UNKNOWN_COMPANY_NAME ? directName : "";
};

const getLegacyCompanyNameById = async (companyId) => {
  const objectId = mongoose.isValidObjectId(companyId)
    ? new mongoose.Types.ObjectId(companyId)
    : null;
  if (!objectId) {
    return "";
  }

  const legacyCompany = await mongoose.connection
    .collection("companies1")
    .findOne({ _id: objectId }, { projection: { name: 1 } });

  return toSafeString(legacyCompany?.name);
};

/** Batch-resolve company display names for analytics (avoids per-session merge loads). */
const resolveCompanyNamesForAnalytics = async (companyIds) => {
  const map = new Map();
  const uniqueIds = [
    ...new Set(
      companyIds.map((id) => String(id || "").trim()).filter(Boolean)
    ),
  ];
  if (uniqueIds.length === 0) return map;

  const objectIds = uniqueIds
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (objectIds.length > 0) {
    const staticRows = await CompanyStatic.find({ _id: { $in: objectIds } })
      .select("name")
      .lean();
    for (const row of staticRows) {
      const name = toSafeString(row.name);
      map.set(String(row._id), name || UNKNOWN_COMPANY_NAME);
    }

    const missing = objectIds.filter((oid) => !map.has(String(oid)));
    if (missing.length > 0) {
      const legacyRows = await mongoose.connection
        .collection("companies1")
        .find({ _id: { $in: missing } }, { projection: { name: 1 } })
        .toArray();
      for (const row of legacyRows) {
        const name = toSafeString(row.name);
        map.set(String(row._id), name || UNKNOWN_COMPANY_NAME);
      }
    }
  }

  for (const id of uniqueIds) {
    if (!map.has(id)) map.set(id, UNKNOWN_COMPANY_NAME);
  }
  return map;
};

export const resolveInterviewMergedCompanyForSession = async (session) => {
  const cid = String(session?.companyId?._id ?? session?.companyId ?? "").trim();
  if (!cid) return null;
  const typeUnd = session?.placementVisitType;
  const clusterUnd = session?.placementCluster;
  const yearUnd = session?.placementYear;
  const legacy =
    typeUnd === undefined && clusterUnd === undefined && yearUnd === undefined;
  if (legacy) {
    const pack = await getCompanyMergedForAdminById(cid);
    return pack?.merged ?? null;
  }
  const mergeByType = session?.mergePlacementByType === true;
  const pack = await getInterviewMergedCompanyPayload(
    cid,
    typeUnd ?? "",
    mergeByType ? "" : clusterUnd ?? "",
    mergeByType ? undefined : yearUnd,
    mergeByType
  );
  return pack?.merged ?? null;
};

export const resolveInterviewCompanyName = async (session, companyNameCache = new Map()) => {
  const directName =
    (toSafeString(session?.companyName) || getCompanyRefName(session?.companyId)) ?? "";
  if (directName && directName !== UNKNOWN_COMPANY_NAME) {
    return directName;
  }

  const companyId = getCompanyRefId(session?.companyId);
  if (!companyId) {
    return UNKNOWN_COMPANY_NAME;
  }

  if (companyNameCache.has(companyId)) {
    return companyNameCache.get(companyId);
  }

  const loadedCompany = await getCompanyMergedForAdminById(companyId);
  const resolvedName =
    toSafeString(loadedCompany?.merged?.name) ||
    toSafeString(loadedCompany?.staticRow?.name) ||
    (await getLegacyCompanyNameById(companyId)) ||
    UNKNOWN_COMPANY_NAME;
  companyNameCache.set(companyId, resolvedName);
  return resolvedName;
};

export const createSession = async (userId, companyId, placementSlice = {}) => {
  const mergeByType = Boolean(placementSlice.mergePlacementByType);
  const norm = normalizeVisitKeyParts(
    placementSlice.placementVisitType,
    mergeByType ? "" : placementSlice.placementCluster
  );
  const placementYear = mergeByType
    ? COMPANY_VISIT_YEAR
    : normalizePlacementVisitYear(placementSlice.placementYear);
  return InterviewSession.create({
    userId,
    companyId,
    placementVisitType: norm.type,
    placementCluster: mergeByType ? "" : norm.cluster,
    placementYear,
    mergePlacementByType: mergeByType,
    state: INTERVIEW_STATES.PREVIEW,
  });
};

export const getSession = async (sessionId) => {
  return InterviewSession.findById(sessionId);
};

/** Plain object (JSON-safe) for read-only status endpoints. */
export const getSessionLean = async (sessionId) => {
  return InterviewSession.findById(sessionId).lean();
};

export const getInProgressSession = async (
  userId,
  companyId,
  placementVisitType,
  placementCluster,
  placementYear,
  mergePlacementByType = false
) => {
  const norm = normalizeVisitKeyParts(placementVisitType, placementCluster);
  if (mergePlacementByType) {
    return InterviewSession.findOne({
      userId,
      companyId,
      state: { $ne: INTERVIEW_STATES.INTERVIEW_COMPLETE },
      mergePlacementByType: true,
      placementVisitType: norm.type,
    }).sort({ updatedAt: -1 });
  }
  const year = normalizePlacementVisitYear(placementYear);
  return InterviewSession.findOne({
    userId,
    companyId,
    state: { $ne: INTERVIEW_STATES.INTERVIEW_COMPLETE },
    placementVisitType: norm.type,
    placementCluster: norm.cluster,
    placementYear: year,
    mergePlacementByType: { $ne: true },
  }).sort({ updatedAt: -1 });
};

export const countCompletedInterviewsForUser = async (userId) => {
  const id = String(userId || "").trim();
  if (!id) return 0;
  return InterviewSession.countDocuments({
    userId: id,
    state: INTERVIEW_STATES.INTERVIEW_COMPLETE,
  });
};

/**
 * @param {string} userId
 * @param {{ bypassLimit?: boolean }} [options]
 */
export const getInterviewStartEligibility = async (userId, options = {}) => {
  const id = String(userId || "").trim();
  if (!id) {
    return {
      canStart: false,
      reason: "UNAUTHORIZED",
      completedCount: 0,
      message: "",
    };
  }

  const completedCount = await countCompletedInterviewsForUser(id);
  if (options.bypassLimit) {
    return {
      canStart: true,
      reason: null,
      completedCount,
      message: "",
    };
  }

  if (completedCount >= 1) {
    return {
      canStart: false,
      reason: INTERVIEW_LIMIT_REASON,
      completedCount,
      message: INTERVIEW_LIMIT_REACHED_MESSAGE,
    };
  }

  return {
    canStart: true,
    reason: null,
    completedCount,
    message: "",
  };
};

export const getUserSessions = async (userId) => {
  return InterviewSession.find({
    userId,
    state: INTERVIEW_STATES.INTERVIEW_COMPLETE,
  })
    .sort({ updatedAt: -1 });
};

/**
 * Lightweight list payload for interview history screen.
 * Excludes heavy arrays like rounds/history to keep initial load fast.
 */
export const getUserSessionSummaries = async (userId) => {
  return InterviewSession.find({
    userId,
    state: INTERVIEW_STATES.INTERVIEW_COMPLETE,
  })
    .select(
      "userId companyId role currentRound currentQuestionIndex roundStatus state roundsPlan roundsDetails totalRounds currentRoundIndex difficultyLevel currentQuestion finalReport.overallScore createdAt updatedAt"
    )
    .sort({ updatedAt: -1 })
    .lean();
};

export const getUserSessionSummariesPaginated = async (userId, page = 1, limit = 10) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(50, Math.max(1, Number(limit) || 10));
  const skip = (pageNumber - 1) * limitNumber;
  const completedFilter = {
    userId,
    state: INTERVIEW_STATES.INTERVIEW_COMPLETE,
  };

  const [items, total] = await Promise.all([
    InterviewSession.find(completedFilter)
      .select(
        "userId companyId role currentRound currentQuestionIndex roundStatus state roundsPlan roundsDetails totalRounds currentRoundIndex difficultyLevel currentQuestion finalReport.overallScore createdAt updatedAt"
      )
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .lean(),
    InterviewSession.countDocuments(completedFilter),
  ]);

  return {
    items,
    pagination: {
      page: pageNumber,
      limit: limitNumber,
      total,
      hasMore: skip + items.length < total,
    },
  };
};

/** Full session detail for a single session, restricted to owner. */
export const getUserSessionDetail = async (userId, sessionId) => {
  return InterviewSession.findOne({ _id: sessionId, userId }).lean();
};

export const discardInProgressSession = async (sessionId) => {
  return InterviewSession.findOneAndDelete({
    _id: sessionId,
    state: { $ne: INTERVIEW_STATES.INTERVIEW_COMPLETE },
  });
};

export const startRound = async (sessionId) => {
  // 1) Fetch session
  const session = await InterviewSession.findById(sessionId);
  if (!session) {
    throw new Error("Interview session not found.");
  }

  // 2) Get currentRound object
  const rounds = Array.isArray(session.rounds) ? session.rounds : [];
  if (rounds.length === 0) {
    throw new Error("Session has no rounds configured.");
  }

  const roundNumber = Number(session.currentRound) || 1;
  const roundIndex = Math.max(0, Math.min(rounds.length - 1, roundNumber - 1));
  const currentRound = rounds[roundIndex];
  if (!currentRound) {
    throw new Error("Current round not found.");
  }

  // 3) Call MCP generateQuestion with companyContext + round context
  const companyData = (await resolveInterviewMergedCompanyForSession(session)) ?? null;
  const companyContext = await getCompanyContext(companyData || {});
  const sessionExclusions = collectSessionQuestionExclusions(session);
  const gen = await generateQuestion({
    userId: String(session.userId || ""),
    companyContext,
    roundType: currentRound.type,
    roundAbout: currentRound.about,
    difficulty: currentRound.difficulty,
    roundQuestionCount: currentRound.questionCount,
    previousQuestion: "",
    previousAnswer: "",
    previousFeedback: "",
    previousScore: null,
    roundHistory: [],
    placementVisitType: session.placementVisitType,
    placementCluster: session.placementCluster,
    placementYear: session.placementYear,
    mergePlacementByType: session.mergePlacementByType === true,
    excludedQuestionIds: sessionExclusions.excludedQuestionIds,
    excludedQuestionTexts: sessionExclusions.excludedQuestionTexts,
  });

  if (gen?.generationError) {
    throw new Error(gen.generationError.message || "Could not start this interview round.");
  }

  const {
    question,
    questionUrl,
    expectedPoints,
    expectedAnswerMode,
    questionId,
    evaluationStrategy,
    supportedCodingLanguages,
    resolvedCodeTestCases,
    resolvedDsaMetadata,
    resolvedTopics,
    resolvedSubtopics,
    resolvedCompanyTags,
    resolvedComplexity,
  } = gen;

  // 4) Store first question in round.questions
  currentRound.questions = [
    {
      question,
      questionUrl: toSafeString(questionUrl),
      questionId: toSafeString(questionId) || undefined,
      supportedCodingLanguages: Array.isArray(supportedCodingLanguages)
        ? supportedCodingLanguages
        : undefined,
      evaluationStrategy: toSafeString(evaluationStrategy) || undefined,
      sourceType: toSafeString(questionId) ? "retrieved" : "generated",
      previewRunCount: 0,
      answer: "",
      score: null,
      feedback: "",
      evaluationTrace: null,
      expectedPoints: expectedPointsFromStrings(expectedPoints, {
        roundType: currentRound.type,
        expectedAnswerMode,
      }),
      ...buildResolvedFieldsForQuestionSlot(gen),
    },
  ];

  // 5) Set currentQuestionIndex = 0
  session.currentQuestionIndex = 0;

  // 6) Set roundStatus = IN_PROGRESS
  currentRound.status = "IN_PROGRESS";
  session.roundStatus = "IN_PROGRESS";
  session.state = INTERVIEW_STATES.ROUND_ACTIVE;
  session.currentRound = roundNumber;
  session.currentRoundIndex = roundIndex;
  session.currentQuestion = question;

  session.markModified("rounds");
  await session.save();

  return {
    question,
    questionUrl: toSafeString(questionUrl),
    roundNumber,
    roundType: currentRound.type,
    difficulty: currentRound.difficulty,
    currentQuestionIndex: 0,
    roundStatus: session.roundStatus,
  };
};

export const generateRoundFeedback = async (sessionId, roundNumber) => {
  // 1) Fetch all answers in that round
  const session = await InterviewSession.findById(sessionId);
  if (!session) {
    throw new Error("Interview session not found.");
  }

  const rounds = Array.isArray(session.rounds) ? session.rounds : [];
  const targetRoundNumber = Number(roundNumber);
  if (!Number.isFinite(targetRoundNumber) || targetRoundNumber < 1) {
    throw new Error("Invalid round number.");
  }

  const roundIndex = targetRoundNumber - 1;
  const round = rounds[roundIndex];
  if (!round) {
    throw new Error("Round not found.");
  }

  const questions = Array.isArray(round.questions) ? round.questions : [];
  const isDsaStyleRound = roundTypeImpliesCodeExecutionInterview(round.type);

  logInterviewDsaLlmDebug("generate_round_feedback_start", {
    sessionIdTail: tailId(sessionId),
    roundNumber: targetRoundNumber,
    roundTypeStored: round.type ?? null,
    roundStatus: round.status ?? null,
    questionCount: questions.length,
    impliesCodeExecutionInterviewRound: isDsaStyleRound,
  });

  // DSA / code-execution rounds: deterministic counts only — no LLM, no strengths/weaknesses lists.
  if (isDsaStyleRound) {
    const dsaRoundStats = computeDsaRoundQuestionBuckets(questions);
    const { totalQuestions, answeredCorrectly, partiallyAnswered, notAnswered } = dsaRoundStats;
    const topicsCoveredThisRound = await collectTopicsForCompletedCodingRound(round);
    const summary = `This round had ${totalQuestions} question${
      totalQuestions === 1 ? "" : "s"
    }. You answered ${answeredCorrectly} correctly, ${partiallyAnswered} partially, and ${notAnswered} with no submission.`;

    round.feedback = {
      summary,
      strengths: [],
      weaknesses: [],
      improvementTips: [],
      dsaRoundStats,
      topicsCoveredThisRound,
    };
    session.markModified("rounds");
    await session.save();

    logInterviewDsaLlmDebug("generate_round_feedback_dsa_counts_only", {
      sessionIdTail: tailId(sessionId),
      roundNumber: targetRoundNumber,
      roundTypeStored: round.type ?? null,
      dsaRoundStats,
    });

    return {
      summary: round.feedback.summary,
      strengths: round.feedback.strengths,
      weaknesses: round.feedback.weaknesses,
      improvementTips: round.feedback.improvementTips,
      dsaRoundStats: round.feedback.dsaRoundStats,
      topicsCoveredThisRound: round.feedback.topicsCoveredThisRound || [],
    };
  }

  const answered = questions.filter(
    (item) => typeof item?.answer === "string" && item.answer.trim().length > 0
  );
  const scores = answered
    .map((item) => Number(item?.score))
    .filter((score) => Number.isFinite(score));

  const averageScore =
    scores.length > 0
      ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10
      : 0;

  const companyData = (await resolveInterviewMergedCompanyForSession(session)) ?? null;
  const companyContext = await getCompanyContext(companyData || {});

  const roundPayload = {
    ...(typeof round.toObject === "function" ? round.toObject() : round),
    aggregate: {
      averageScore,
      scores,
    },
  };

  logInterviewDsaLlmDebug("generate_round_feedback_llm_path", {
    sessionIdTail: tailId(sessionId),
    roundNumber: targetRoundNumber,
    roundTypeStored: round.type ?? null,
    impliesCodeExecutionInterviewRound: false,
    answeredWithTextCount: answered.length,
    finiteScoreCount: scores.length,
    averageScore,
  });

  let feedback = await generateRoundFeedbackLLM({
    roundData: roundPayload,
    companyContext,
  });

  if (!feedback) {
    logInterviewDsaLlmDebug("generate_round_feedback_llm_empty_try_mcp", {
      sessionIdTail: tailId(sessionId),
      roundNumber: targetRoundNumber,
      roundTypeStored: round.type ?? null,
    });
    feedback = await generateRoundFeedbackMCP({
      roundData: roundPayload,
      companyContext,
    });
  } else {
    logInterviewDsaLlmDebug("generate_round_feedback_llm_ok", {
      sessionIdTail: tailId(sessionId),
      roundNumber: targetRoundNumber,
      roundTypeStored: round.type ?? null,
    });
  }

  round.feedback = {
    summary: feedback.summary,
    strengths: Array.isArray(feedback.strengths) ? feedback.strengths : [],
    weaknesses: Array.isArray(feedback.weaknesses) ? feedback.weaknesses : [],
    improvementTips: Array.isArray(feedback.improvementTips)
      ? feedback.improvementTips
      : [],
  };
  session.markModified("rounds");
  await session.save();

  return {
    summary: round.feedback.summary,
    strengths: round.feedback.strengths,
    weaknesses: round.feedback.weaknesses,
    improvementTips: round.feedback.improvementTips,
  };
};

const ANALYTICS_SESSION_SELECT =
  "companyId companyName finalReport.overallScore rounds.type rounds.questions.score history.score updatedAt state";

const resolveAnalyticsCompanyName = (session, nameById) => {
  const directName =
    toSafeString(session?.companyName) || getCompanyRefName(session?.companyId);
  if (directName && directName !== UNKNOWN_COMPANY_NAME) {
    return directName;
  }
  const companyId = getCompanyRefId(session?.companyId);
  if (!companyId) return UNKNOWN_COMPANY_NAME;
  return nameById.get(companyId) || UNKNOWN_COMPANY_NAME;
};

/** Average scores by round type + one progress point per session (chronological) for analytics UI. */
export const buildUserInterviewAnalytics = async (userId) => {
  const sessions = await InterviewSession.find({
    userId,
    state: INTERVIEW_STATES.INTERVIEW_COMPLETE,
  })
    .select(ANALYTICS_SESSION_SELECT)
    .sort({ updatedAt: 1 })
    .lean();

  const companyIds = sessions
    .map((session) => getCompanyRefId(session.companyId))
    .filter(Boolean);
  const nameById = await resolveCompanyNamesForAnalytics(companyIds);

  const skillTotals = {};
  const progress = [];

  for (const session of sessions) {
    const rounds = Array.isArray(session.rounds) ? session.rounds : [];
    const companyName = resolveAnalyticsCompanyName(session, nameById);

    for (const round of rounds) {
      const type = round.type || "General";
      const questions = Array.isArray(round.questions) ? round.questions : [];
      for (const q of questions) {
        const s = Number(q?.score);
        if (Number.isFinite(s)) {
          if (!skillTotals[type]) skillTotals[type] = { sum: 0, count: 0 };
          skillTotals[type].sum += s;
          skillTotals[type].count += 1;
        }
      }
    }

    let sessionScore = null;
    const fr = session.finalReport;
    if (
      fr &&
      typeof fr.overallScore === "number" &&
      Number.isFinite(fr.overallScore)
    ) {
      sessionScore = fr.overallScore;
    } else {
      const scores = [];
      for (const round of rounds) {
        for (const q of round.questions || []) {
          const s = Number(q?.score);
          if (Number.isFinite(s)) scores.push(s);
        }
      }
      const hist = Array.isArray(session.history) ? session.history : [];
      for (const h of hist) {
        const s = Number(h?.score);
        if (Number.isFinite(s)) scores.push(s);
      }
      if (scores.length > 0) {
        sessionScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      }
    }

    if (sessionScore != null) {
      progress.push({
        score: Math.round(sessionScore * 10) / 10,
        companyName,
      });
    }
  }

  const skillBreakdown = {};
  for (const [type, { sum, count }] of Object.entries(skillTotals)) {
    if (count > 0) {
      skillBreakdown[type] = Math.round((sum / count) * 10) / 10;
    }
  }

  return { skillBreakdown, progress };
};

/** Read-through Redis cache for analytics (5 min TTL). */
export const getUserInterviewAnalytics = async (userId) => {
  const cached = await getCachedInterviewAnalytics(userId);
  if (cached) return cached;
  const data = await buildUserInterviewAnalytics(userId);
  await setCachedInterviewAnalytics(userId, data);
  return data;
};

export const updateSession = async (sessionId, data) => {
  return InterviewSession.findByIdAndUpdate(
    sessionId,
    { $set: data },
    updateOptions
  );
};

export const addInteraction = async (sessionId, interactionObject) => {
  return InterviewSession.findByIdAndUpdate(
    sessionId,
    { $push: { history: interactionObject } },
    updateOptions
  );
};

