import mongoose from "mongoose";
import InterviewSession from "../models/InterviewSession.js";
import { getCompanyMergedForAdminById } from "./companyService.js";
import { getCompanyContext } from "./mcp/getCompanyContext.js";
import { generateQuestion, normalizeExpectedPoints } from "./mcp/generateQuestion.js";
import { generateRoundFeedback as generateRoundFeedbackMCP } from "./mcp/generateRoundFeedback.js";
import { INTERVIEW_STATES } from "./interviewStateMachine.js";

const updateOptions = {
  new: true,
  runValidators: true,
};

const UNKNOWN_COMPANY_NAME = "Unknown Company";

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

export const createSession = async (userId, companyId) => {
  return InterviewSession.create({
    userId,
    companyId,
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

export const getInProgressSession = async (userId, companyId) => {
  return InterviewSession.findOne({
    userId,
    companyId,
    state: { $ne: INTERVIEW_STATES.INTERVIEW_COMPLETE },
  }).sort({ updatedAt: -1 });
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
  const companyData =
    (await getCompanyMergedForAdminById(String(session.companyId)))?.merged ?? null;
  const companyContext = await getCompanyContext(companyData || {});
  const { question, expectedPoints, expectedAnswerMode } = await generateQuestion({
    userId: String(session.userId || ""),
    companyContext,
    roundType: currentRound.type,
    roundAbout: currentRound.about,
    difficulty: currentRound.difficulty,
    previousQuestion: "",
    previousAnswer: "",
    previousFeedback: "",
    previousScore: null,
    roundHistory: [],
  });

  // 4) Store first question in round.questions
  currentRound.questions = [
    {
      question,
      answer: "",
      score: null,
      feedback: "",
      evaluationTrace: null,
      expectedPoints: expectedPointsFromStrings(expectedPoints, {
        roundType: currentRound.type,
        expectedAnswerMode,
      }),
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
  const answered = questions.filter(
    (item) => typeof item?.answer === "string" && item.answer.trim().length > 0
  );
  const scores = answered
    .map((item) => Number(item?.score))
    .filter((score) => Number.isFinite(score));

  // 2) Aggregate average score + raw strengths/weakness signals
  const averageScore =
    scores.length > 0
      ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10
      : 0;

  const strengths = [];
  const weaknesses = [];

  if (averageScore >= 8) {
    strengths.push("Consistently strong answers in this round.");
  } else if (averageScore >= 6) {
    strengths.push("Decent baseline performance in this round.");
    weaknesses.push("Answers can be sharper and more structured.");
  } else {
    weaknesses.push("Needs significant improvement in core concepts for this round.");
  }

  if (answered.length < questions.length) {
    weaknesses.push("Not all round questions were fully answered.");
  }

  // Fetch company context for MCP round feedback tool input.
  const companyData =
    (await getCompanyMergedForAdminById(String(session.companyId)))?.merged ?? null;
  const companyContext = await getCompanyContext(companyData || {});

  // 3) Call MCP generateRoundFeedback (new tool)
  const feedback = await generateRoundFeedbackMCP({
    roundData: {
      ...(typeof round.toObject === "function" ? round.toObject() : round),
      aggregate: {
        averageScore,
        strengths,
        weaknesses,
        scores,
      },
    },
    companyContext,
  });

  // 4) Store feedback inside round.feedback
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

  // 5) Return structured feedback
  return {
    summary: round.feedback.summary,
    strengths: round.feedback.strengths,
    weaknesses: round.feedback.weaknesses,
    improvementTips: round.feedback.improvementTips,
  };
};

/** Average scores by round type + one progress point per session (chronological) for analytics UI. */
export const buildUserInterviewAnalytics = async (userId) => {
  const sessions = await InterviewSession.find({ userId })
    .sort({ updatedAt: 1 })
    .lean();

  const skillTotals = {};
  const progress = [];
  const companyNameCache = new Map();

  for (const session of sessions) {
    const rounds = Array.isArray(session.rounds) ? session.rounds : [];
    const companyName = await resolveInterviewCompanyName(session, companyNameCache);

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
        companyName 
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

