import express from "express";
import mongoose from "mongoose";
import CompanyStatic from "../models/CompanyStatic.js";
import {
  getInterviewMergedCompanyPayload,
  listInterviewVisitSlotsForCompany,
  normalizePlacementVisitYear,
  normalizeVisitKeyParts,
} from "../services/companyService.js";

const parseMergePlacementByType = (raw) =>
  raw === true || raw === "true" || raw === "1" || raw === 1;
import authJWT from "../middleware/authJWT.js";
import checkBetaAccess from "../middleware/checkBetaAccess.js";
import authorize from "../middleware/authorize.js";
import validateRequest from "../middleware/validateRequest.js";
import {
  interviewStartSchema,
  interviewSubmitAnswerSchema,
  interviewMoveRoundSchema,
} from "../validations/interview.validation.js";
import {
  createSession,
  getSession,
  getSessionLean,
  getInProgressSession,
  getUserSessionSummariesPaginated,
  getUserSessionDetail,
  buildUserInterviewAnalytics,
  updateSession,
  discardInProgressSession,
  startRound,
  resolveInterviewCompanyName,
} from "../services/interviewSessionService.js";
import { generateInterviewPlan } from "../services/interviewEngine.js";
import { interviewQueue } from "../services/queues/interviewQueue.js";
import { EVALUATE_ANSWER } from "../services/queues/jobTypes.js";
import { buildInterviewTips } from "../utils/interviewTips.js";
import {
  mirrorLegacyAttemptsIntoSlot,
  normalizedQuestionAttempts,
  isQuestionRetryPendingSlot,
} from "../utils/interviewQuestionAttempts.js";
import { INTERVIEW_STATES, assertValidTransition } from "../services/interviewStateMachine.js";
import {
  getCachedInterviewSummaries,
  setCachedInterviewSummaries,
  invalidateInterviewSummaries,
  getCachedInterviewDetail,
  setCachedInterviewDetail,
  invalidateInterviewDetail,
  markInterviewProcessing,
  isInterviewProcessing,
  clearInterviewProcessing,
} from "../services/interviewCache.js";

const router = express.Router();
router.use(authJWT);
router.use(checkBetaAccess);
router.use(authorize(["student", "admin"]));

const getAuthenticatedUserId = (req) => String(req.user?.userId || "").trim();
const isSessionOwner = (session, userId) => String(session?.userId || "") === userId;

const toClientStatus = (state) =>
  state === INTERVIEW_STATES.INTERVIEW_COMPLETE ? "completed" : "in_progress";

const toClientInterviewStatus = (state) =>
  state === INTERVIEW_STATES.INTERVIEW_COMPLETE ? "COMPLETED" : "IN_PROGRESS";

const toRelevanceLabel = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric >= 0.62 ? "relevant" : "irrelevant";
};

/** 0-based index into `session.rounds`; `currentRound` (1-based) is the source of truth. */
function roundIndexFromCurrentRound(session) {
  const rounds = Array.isArray(session.rounds) ? session.rounds : [];
  const currentRoundNumber = Number(session.currentRound) || 1;
  return Math.max(0, Math.min(rounds.length - 1, currentRoundNumber - 1));
}

const buildSessionSummaryPayload = async (session, companyNameCache) => {
  const companyName = await resolveInterviewCompanyName(session, companyNameCache);
  return {
    _id: session._id,
    userId: session.userId,
    companyId: session.companyId?._id || session.companyId || null,
    companyName,
    companyType: session.companyId?.type || session.companyType || "",
    role: session.role || "",
    currentRound: session.currentRound || "",
    currentQuestionIndex: session.currentQuestionIndex || 0,
    roundStatus: session.roundStatus || "IN_PROGRESS",
    interviewStatus: toClientInterviewStatus(session.state),
    roundsPlan: session.roundsPlan || [],
    roundsDetails: session.roundsDetails || [],
    totalRounds: session.totalRounds || 0,
    currentRoundIndex: roundIndexFromCurrentRound(session),
    difficultyLevel: session.difficultyLevel || "",
    currentQuestion: session.currentQuestion || null,
    status: toClientStatus(session.state),
    state: session.state || INTERVIEW_STATES.PREVIEW,
    finalScore:
      typeof session?.finalReport?.overallScore === "number"
        ? session.finalReport.overallScore
        : null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
};

const buildSessionDetailPayload = async (session, companyNameCache) => {
  const companyName = await resolveInterviewCompanyName(session, companyNameCache);
  return {
    _id: session._id,
    userId: session.userId,
    companyId: session.companyId?._id || session.companyId || null,
    companyName,
    companyType: session.companyId?.type || session.companyType || "",
    role: session.role || "",
    history: session.history || [],
    currentRound: session.currentRound || "",
    currentQuestionIndex: session.currentQuestionIndex || 0,
    roundStatus: session.roundStatus || "IN_PROGRESS",
    interviewStatus: toClientInterviewStatus(session.state),
    rounds: session.rounds || [],
    roundsPlan: session.roundsPlan || [],
    roundsDetails: session.roundsDetails || [],
    totalRounds: session.totalRounds || 0,
    currentRoundIndex: roundIndexFromCurrentRound(session),
    difficultyLevel: session.difficultyLevel || "",
    currentQuestion: session.currentQuestion || null,
    status: toClientStatus(session.state),
    state: session.state || INTERVIEW_STATES.PREVIEW,
    finalReport: session.finalReport || null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
};

const clampPage = (value) => Math.max(1, Number(value) || 1);
const clampLimit = (value) => Math.min(50, Math.max(1, Number(value) || 10));
const latencyWindows = {
  sessions: [],
  sessionDetail: [],
};

function recordLatencyMetric(metricName, durationMs) {
  const window = latencyWindows[metricName];
  if (!window) return;
  window.push(Number(durationMs) || 0);
  if (window.length > 200) window.shift();
  if (window.length % 25 !== 0) return;
  const sorted = [...window].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
  const p95 = sorted[index];
  console.info(`[interview-metrics] ${metricName}`, {
    samples: sorted.length,
    p95Ms: p95,
    latestMs: Number(durationMs) || 0,
  });
}

async function invalidateSessionAndSummaryCaches(userId, sessionId) {
  await Promise.all([
    invalidateInterviewDetail(sessionId),
    invalidateInterviewSummaries(userId),
  ]);
}

router.get("/visit-options/:companyId", async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!companyId || !mongoose.isValidObjectId(String(companyId))) {
      return res.status(400).json({ error: "Valid companyId is required" });
    }
    const exists = await CompanyStatic.findById(companyId).select("_id").lean();
    if (!exists) {
      return res.status(404).json({ error: "Company not found" });
    }
    const { slots } = await listInterviewVisitSlotsForCompany(companyId);
    return res.json({ slots });
  } catch (error) {
    console.error("❌ Error listing interview visit options:", error.message);
    return res.status(500).json({ error: "Failed to list placement slots" });
  }
});

router.post("/start-interview", validateRequest(interviewStartSchema), async (req, res) => {
  try {
    const {
      companyId,
      placementVisitType,
      placementCluster,
      placementYear: placementYearRaw,
      mergePlacementByType: mergePlacementByTypeRaw,
    } = req.body;
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!companyId) {
      return res.status(400).json({
        error: "companyId is required",
      });
    }

    const mergePlacementByType = parseMergePlacementByType(mergePlacementByTypeRaw);
    const norm = normalizeVisitKeyParts(
      placementVisitType,
      mergePlacementByType ? "" : placementCluster
    );
    const placementYear = mergePlacementByType
      ? normalizePlacementVisitYear(undefined)
      : normalizePlacementVisitYear(placementYearRaw);
    const loaded = await getInterviewMergedCompanyPayload(
      String(companyId),
      norm.type,
      norm.cluster,
      placementYear,
      mergePlacementByType
    );
    if (!loaded?.staticRow || !loaded.merged) {
      return res.status(404).json({ error: "Company not found" });
    }
    const companyData = loaded.merged;

    let session = await getInProgressSession(
      userId,
      companyId,
      norm.type,
      mergePlacementByType ? "" : norm.cluster,
      placementYear,
      mergePlacementByType
    );
    const createdNewSession = !session;
    if (!session) {
      session = await createSession(userId, companyId, {
        placementVisitType: norm.type,
        placementCluster: mergePlacementByType ? "" : norm.cluster,
        placementYear,
        mergePlacementByType,
      });
    }

    const isAlreadyInitialized = Boolean(session.currentQuestion);
    let responsePayload = null;

    if (isAlreadyInitialized) {
      responsePayload = {
        question: session.currentQuestion,
        status: toClientStatus(session.state),
        currentRound: session.currentRound || 1,
        currentQuestionIndex: session.currentQuestionIndex ?? 0,
        roundStatus: session.roundStatus || "IN_PROGRESS",
        interviewStatus: toClientInterviewStatus(session.state),
        rounds: session.rounds || [],
        roundsPlan: session.roundsPlan || [],
        roundsDetails: session.roundsDetails || [],
        totalRounds: session.totalRounds || 0,
        currentRoundIndex: roundIndexFromCurrentRound(session),
        difficultyLevel: session.difficultyLevel || null,
        placementVisitType: session.placementVisitType ?? norm.type,
        placementCluster: session.placementCluster ?? norm.cluster,
        placementYear: session.placementYear ?? placementYear,
        mergePlacementByType:
          session.mergePlacementByType === true ? true : mergePlacementByType,
      };
    } else {
      const plan = await generateInterviewPlan(companyData);
      await updateSession(session._id, {
        rounds: plan.rounds,
        roundsPlan: plan.roundsPlan || [],
        roundsDetails: plan.roundsDetails || [],
        totalRounds: plan.totalRounds,
        currentRound: 1,
        currentRoundIndex: 0,
        currentQuestionIndex: 0,
        roundStatus: "IN_PROGRESS",
        state: INTERVIEW_STATES.IN_PROGRESS,
      });

      const roundStart = await startRound(session._id);
      const refreshedSession = await getSession(session._id);
      responsePayload = {
        question: roundStart.question,
        status: toClientStatus(refreshedSession?.state),
        currentRound: refreshedSession?.currentRound || 1,
        currentQuestionIndex: refreshedSession?.currentQuestionIndex ?? 0,
        roundStatus: refreshedSession?.roundStatus || "IN_PROGRESS",
        interviewStatus: toClientInterviewStatus(refreshedSession?.state),
        rounds: refreshedSession?.rounds || [],
        roundsPlan: refreshedSession?.roundsPlan || [],
        roundsDetails: refreshedSession?.roundsDetails || [],
        totalRounds: refreshedSession?.totalRounds || plan.totalRounds || 0,
        currentRoundIndex: refreshedSession ? roundIndexFromCurrentRound(refreshedSession) : 0,
        difficultyLevel:
          refreshedSession?.rounds?.[0]?.difficulty || refreshedSession?.difficultyLevel || null,
        placementVisitType: refreshedSession?.placementVisitType ?? norm.type,
        placementCluster: refreshedSession?.placementCluster ?? norm.cluster,
        placementYear: refreshedSession?.placementYear ?? placementYear,
        mergePlacementByType:
          refreshedSession?.mergePlacementByType === true ? true : mergePlacementByType,
      };
    }

    await Promise.all([
      invalidateInterviewSummaries(userId),
      invalidateInterviewDetail(session._id),
    ]);

    return res.status(createdNewSession ? 201 : 200).json({
      sessionId: session._id,
      ...responsePayload,
      resumed: isAlreadyInitialized,
    });
  } catch (error) {
    console.error("❌ Error starting interview:", error.message);
    return res.status(500).json({ error: "Failed to start interview" });
  }
});

router.get("/resume-interview", async (req, res) => {
  try {
    const {
      companyId,
      placementVisitType,
      placementCluster,
      placementYear: placementYearRaw,
      mergePlacementByType: mergePlacementByTypeRaw,
    } = req.query;
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!companyId) {
      return res.status(400).json({
        error: "companyId is required",
      });
    }

    const mergePlacementByType = parseMergePlacementByType(mergePlacementByTypeRaw);
    const norm = normalizeVisitKeyParts(
      placementVisitType,
      mergePlacementByType ? "" : placementCluster
    );
    const placementYear = mergePlacementByType
      ? normalizePlacementVisitYear(undefined)
      : normalizePlacementVisitYear(placementYearRaw);
    const session = await getInProgressSession(
      userId,
      companyId,
      norm.type,
      mergePlacementByType ? "" : norm.cluster,
      placementYear,
      mergePlacementByType
    );
    if (!session) {
      return res.json({
        resumable: false,
        sessionId: null,
        question: null,
        status: "idle",
        placementVisitType: norm.type,
        placementCluster: norm.cluster,
        placementYear,
        mergePlacementByType,
      });
    }

    return res.json({
      resumable: true,
      sessionId: session._id,
      question: session.currentQuestion || null,
      status: toClientStatus(session.state),
      currentRound: session.currentRound || null,
      currentQuestionIndex: session.currentQuestionIndex || 0,
      roundStatus: session.roundStatus || "IN_PROGRESS",
      interviewStatus: toClientInterviewStatus(session.state),
      rounds: session.rounds || [],
      roundsPlan: session.roundsPlan || [],
      roundsDetails: session.roundsDetails || [],
      totalRounds: session.totalRounds || 0,
      currentRoundIndex: roundIndexFromCurrentRound(session),
      difficultyLevel: session.difficultyLevel || null,
      historyCount: Array.isArray(session.history) ? session.history.length : 0,
      placementVisitType: session.placementVisitType ?? norm.type,
      placementCluster: session.placementCluster ?? norm.cluster,
      placementYear: session.placementYear ?? placementYear,
      mergePlacementByType:
        session.mergePlacementByType === true ? true : mergePlacementByType,
    });
  } catch (error) {
    console.error("❌ Error resuming interview:", error.message);
    return res.status(500).json({ error: "Failed to fetch resumable interview" });
  }
});

router.get("/sessions/:userId", async (req, res) => {
  const startedAt = Date.now();
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const page = clampPage(req.query.page);
    const limit = clampLimit(req.query.limit);
    const cached = await getCachedInterviewSummaries(userId, page, limit);
    const companyNameCache = new Map();
    if (cached) {
      const items = await Promise.all(
        (Array.isArray(cached?.items) ? cached.items : []).map((session) =>
          buildSessionSummaryPayload(session, companyNameCache)
        )
      );
      recordLatencyMetric("sessions", Date.now() - startedAt);
      console.info("[interview-sessions] cache hit", {
        userId,
        page,
        limit,
        durationMs: Date.now() - startedAt,
      });
      return res.json({
        ...cached,
        items,
      });
    }

    const { items, pagination } = await getUserSessionSummariesPaginated(userId, page, limit);
    const payload = {
      items: await Promise.all(
        items.map((session) => buildSessionSummaryPayload(session, companyNameCache))
      ),
      pagination,
    };
    await setCachedInterviewSummaries(userId, page, limit, payload);
    recordLatencyMetric("sessions", Date.now() - startedAt);
    console.info("[interview-sessions] cache miss", {
      userId,
      page,
      limit,
      count: payload.items.length,
      durationMs: Date.now() - startedAt,
    });
    return res.json(payload);
  } catch (error) {
    console.error("❌ Error fetching interview sessions:", error.message);
    return res.status(500).json({ error: "Failed to fetch interview history" });
  }
});

router.get("/session/:sessionId", async (req, res) => {
  const startedAt = Date.now();
  try {
    const userId = getAuthenticatedUserId(req);
    const { sessionId } = req.params;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const cached = await getCachedInterviewDetail(sessionId);
    if (cached) {
      if (!isSessionOwner(cached, userId)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const payload = await buildSessionDetailPayload(cached, new Map());
      recordLatencyMetric("sessionDetail", Date.now() - startedAt);
      console.info("[interview-session-detail] cache hit", {
        sessionId,
        durationMs: Date.now() - startedAt,
      });
      return res.json(payload);
    }

    const session = await getUserSessionDetail(userId, sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const payload = await buildSessionDetailPayload(session, new Map());
    await setCachedInterviewDetail(sessionId, payload);
    recordLatencyMetric("sessionDetail", Date.now() - startedAt);
    console.info("[interview-session-detail] cache miss", {
      sessionId,
      durationMs: Date.now() - startedAt,
    });
    return res.json(payload);
  } catch (error) {
    console.error("❌ Error fetching interview session detail:", error.message);
    return res.status(500).json({ error: "Failed to fetch interview detail" });
  }
});

router.get("/analytics/:userId", async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const data = await buildUserInterviewAnalytics(userId);
    return res.json(data);
  } catch (error) {
    console.error("❌ Error fetching interview analytics:", error.message);
    return res.status(500).json({ error: "Failed to fetch interview analytics" });
  }
});

router.post("/submit-answer", validateRequest(interviewSubmitAnswerSchema), async (req, res) => {
  try {
    const { sessionId, answer } = req.body;
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!sessionId || typeof answer !== "string" || !answer.trim()) {
      return res.status(400).json({
        error: "sessionId and answer are required",
      });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (!isSessionOwner(session, userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    try {
      await markInterviewProcessing(sessionId);
      await invalidateSessionAndSummaryCaches(userId, sessionId);
      const job = await interviewQueue.add(EVALUATE_ANSWER, {
        sessionId,
        answer: answer.trim(),
      });
      console.log("[submit-answer] BullMQ job enqueued", {
        jobId: job.id,
        name: EVALUATE_ANSWER,
        sessionId,
      });
    } catch (queueError) {
      await clearInterviewProcessing(sessionId);
      console.warn("[submit-answer] BullMQ enqueue failed:", queueError?.message || queueError);
      return res.status(503).json({ error: "Interview queue unavailable" });
    }

    return res.json({
      status: "processing",
      sessionId,
    });
  } catch (error) {
    console.error("❌ Error submitting interview answer:", error?.stack || error?.message || error);
    return res.status(500).json({ error: "Failed to submit answer" });
  }
});

router.get("/interview-status/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const session = await getSessionLean(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (!isSessionOwner(session, userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rounds = Array.isArray(session.rounds) ? session.rounds : [];
    const currentRoundNumber = Number(session.currentRound) || 1;
    const currentRoundIndex = Math.max(0, Math.min(rounds.length - 1, currentRoundNumber - 1));
    const currentQuestionIndex = Number(session.currentQuestionIndex) || 0;
    const currentRoundDoc = rounds[currentRoundIndex];
    const prevQuestion =
      currentQuestionIndex > 0 && currentRoundDoc?.questions
        ? currentRoundDoc.questions[currentQuestionIndex - 1]
        : null;

    const slotNow = currentRoundDoc?.questions?.[currentQuestionIndex];
    const retryPending = isQuestionRetryPendingSlot(slotNow);

    const exposePrevFeedback =
      !retryPending &&
      prevQuestion &&
      typeof prevQuestion.answer === "string" &&
      prevQuestion.answer.trim() !== "";

    const slotQuestion = currentRoundDoc?.questions?.[currentQuestionIndex]?.question;
    const rawCurrentQ = session.currentQuestion;
    const effectiveCurrentQuestion =
      (typeof rawCurrentQ === "string" && rawCurrentQ.trim() !== ""
        ? rawCurrentQ.trim()
        : null) ||
      (typeof slotQuestion === "string" && slotQuestion.trim() !== ""
        ? slotQuestion.trim()
        : null) ||
      null;
    const hasActiveQuestion = Boolean(effectiveCurrentQuestion);

    const roundType = session.rounds[currentRoundIndex]?.type;
    const companyName = await resolveInterviewCompanyName(session, new Map());
    const selectedTips = buildInterviewTips({
      roundType,
      difficulty: currentRoundDoc?.difficulty || session.difficultyLevel,
      currentQuestion: effectiveCurrentQuestion || prevQuestion?.question || "",
      companyName,
      currentQuestionIndex,
      desiredCount: 8,
    });

    const sessionInterviewStatus = session.state;
    const roundCompleted =
      sessionInterviewStatus !== INTERVIEW_STATES.INTERVIEW_COMPLETE &&
      session.roundStatus === "COMPLETED" &&
      !hasActiveQuestion;
    const nextRoundAvailable =
      roundCompleted && currentRoundIndex + 1 < rounds.length;
    const fb = currentRoundDoc?.feedback;
    const roundFeedback =
      roundCompleted && fb
        ? {
            score: typeof fb.score === "number" ? fb.score : null,
            strengths: Array.isArray(fb.strengths) ? fb.strengths : [],
            weaknesses: Array.isArray(fb.weaknesses) ? fb.weaknesses : [],
            summary: fb.summary || "",
          }
        : null;
    const report =
      session.state === INTERVIEW_STATES.INTERVIEW_COMPLETE
        ? session.finalReport || null
        : null;

    if (
      !effectiveCurrentQuestion &&
      Number(currentQuestionIndex) > 0 &&
      session.state !== INTERVIEW_STATES.INTERVIEW_COMPLETE &&
      session.roundStatus !== "COMPLETED"
    ) {
      console.warn("[interview-status] anomaly: in_progress, question index > 0, but no effective question", {
        sessionTail: String(sessionId).slice(-8),
        currentQuestionIndex,
        rawRootLen: typeof session.currentQuestion === "string" ? session.currentQuestion.length : 0,
        slotLen: typeof slotQuestion === "string" ? slotQuestion.length : 0,
        roundIndex: currentRoundIndex,
      });
    }
    if (process.env.DEBUG_INTERVIEW_STATUS === "1") {
      console.info("[interview-status] trace", {
        sessionTail: String(sessionId).slice(-8),
        currentQuestionIndex,
        effectiveLen: effectiveCurrentQuestion ? effectiveCurrentQuestion.length : 0,
        roundCompleted,
        status: toClientStatus(session.state),
      });
    }

    const isProcessing =
      session.state === INTERVIEW_STATES.EVALUATING ||
      (await isInterviewProcessing(sessionId));

    const roundsQuestionSummary = rounds.map((r, idx) => {
      const roundNumber = typeof r.roundNumber === "number" ? r.roundNumber : idx + 1;
      let questionCount =
        typeof r.questionCount === "number" && Number.isFinite(r.questionCount)
          ? Math.round(r.questionCount)
          : null;
      const slots = Array.isArray(r.questions) ? r.questions.length : 0;
      if (questionCount == null || questionCount < 1) {
        questionCount = Math.max(slots, 3);
      }
      questionCount = Math.min(5, Math.max(3, questionCount));
      return { roundNumber, questionCount };
    });

    const questionsPlannedThisRound =
      typeof currentRoundDoc?.questionCount === "number" &&
      Number.isFinite(currentRoundDoc.questionCount)
        ? Math.min(5, Math.max(3, Math.round(currentRoundDoc.questionCount)))
        : roundsQuestionSummary[currentRoundIndex]?.questionCount ??
          Math.max(Array.isArray(currentRoundDoc?.questions) ? currentRoundDoc.questions.length : 0, 3);

    const currentQuestionNumberWithinRound = currentQuestionIndex + 1;

    const lastQuestionCanReattempt =
      exposePrevFeedback &&
      normalizedQuestionAttempts(prevQuestion).length === 1 &&
      session.state !== INTERVIEW_STATES.INTERVIEW_COMPLETE &&
      !isProcessing;

    return res.json({
      status: toClientStatus(session.state),
      currentRound: session.currentRound,
      currentQuestion: effectiveCurrentQuestion,
      currentQuestionIndex: session.currentQuestionIndex,
      lastScore: exposePrevFeedback ? prevQuestion?.score ?? null : null,
      lastFeedback: exposePrevFeedback ? prevQuestion?.feedback ?? null : null,
      lastQuestion:
        exposePrevFeedback &&
        typeof prevQuestion?.question === "string" &&
        prevQuestion.question.trim() !== ""
          ? prevQuestion.question.trim()
          : null,
      lastCorrectness: exposePrevFeedback ? prevQuestion?.evaluationTrace?.verdict ?? null : null,
      lastRelevance: exposePrevFeedback
        ? toRelevanceLabel(prevQuestion?.evaluationTrace?.relevance)
        : null,
      lastQuestionCanReattempt,
      roundStatus: currentRoundDoc?.status ?? session.roundStatus ?? null,
      interviewStatus: toClientInterviewStatus(session.state),
      roundType: roundType ?? null,
      roundsQuestionSummary,
      questionsPlannedThisRound,
      currentQuestionNumberWithinRound,
      isProcessing,
      tips: selectedTips,
      totalRounds: session.totalRounds || 0,
      roundCompleted,
      nextRoundAvailable,
      roundFeedback,
      report,
    });
  } catch (error) {
    console.error("❌ Error fetching interview status:", error?.message || error);
    return res.status(500).json({ error: "Failed to fetch interview status" });
  }
});

router.post("/begin-question-reattempt", validateRequest(interviewMoveRoundSchema), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (!isSessionOwner(session, userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (session.state === INTERVIEW_STATES.INTERVIEW_COMPLETE) {
      return res.status(400).json({ error: "Interview is complete; cannot reattempt questions." });
    }
    if (await isInterviewProcessing(sessionId)) {
      return res.status(409).json({ error: "Wait until evaluation finishes before reattempting." });
    }

    const rounds = Array.isArray(session.rounds) ? session.rounds : [];
    const ri = roundIndexFromCurrentRound(session);
    const round = rounds[ri];
    if (!round) {
      return res.status(400).json({ error: "Round not found" });
    }

    const idx = Number(session.currentQuestionIndex) || 0;
    if (idx < 1) {
      return res.status(400).json({ error: "There is no previous question to reattempt yet." });
    }
    const prevIdx = idx - 1;
    const qs = Array.isArray(round.questions) ? round.questions : [];
    const prevSlot = qs[prevIdx];
    if (!prevSlot || typeof prevSlot.question !== "string" || !prevSlot.question.trim()) {
      return res.status(400).json({ error: "Could not resolve the question to reattempt." });
    }

    mirrorLegacyAttemptsIntoSlot(prevSlot);
    const attemptsNorm = normalizedQuestionAttempts(prevSlot);
    if (attemptsNorm.length !== 1) {
      return res.status(400).json({
        error:
          attemptsNorm.length >= 2
            ? "You already used your one reattempt for this question."
            : "No graded attempt found for this question yet.",
      });
    }

    prevSlot.answer = "";
    prevSlot.feedback = "";
    prevSlot.score = null;
    prevSlot.evaluationTrace = null;

    session.currentQuestionIndex = prevIdx;
    session.currentQuestion = prevSlot.question.trim();

    if (round.status === "COMPLETED") {
      round.status = "IN_PROGRESS";
      session.roundStatus = "IN_PROGRESS";
      round.feedback = {
        summary: "",
        strengths: [],
        weaknesses: [],
        improvementTips: [],
      };
    }

    if (session.state === INTERVIEW_STATES.ROUND_COMPLETE) {
      assertValidTransition(session.state, INTERVIEW_STATES.ROUND_ACTIVE);
      session.state = INTERVIEW_STATES.ROUND_ACTIVE;
    }

    session.currentRoundIndex = ri;
    session.markModified("rounds");
    session.markModified("currentQuestion");
    session.markModified("currentQuestionIndex");
    session.markModified("roundStatus");
    session.markModified("state");
    session.markModified("currentRoundIndex");

    await session.save();
    await invalidateInterviewDetail(sessionId);
    await invalidateInterviewSummaries(userId);

    return res.json({ ok: true });
  } catch (error) {
    console.error("❌ Error beginning question reattempt:", error?.stack || error?.message || error);
    return res.status(500).json({ error: "Failed to begin question reattempt" });
  }
});

router.post("/move-to-next-round", validateRequest(interviewMoveRoundSchema), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (!isSessionOwner(session, userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (session.state === INTERVIEW_STATES.INTERVIEW_COMPLETE) {
      return res.status(400).json({ error: "Interview already completed" });
    }

    const rounds = Array.isArray(session.rounds) ? session.rounds : [];
    if (rounds.length === 0) {
      return res.status(400).json({ error: "Rounds are not initialized" });
    }

    const currentRoundNumber = Number(session.currentRound) || 1;
    const currentRoundIndex = Math.max(0, Math.min(rounds.length - 1, currentRoundNumber - 1));
    const currentRound = rounds[currentRoundIndex];
    if (!currentRound || currentRound.status !== "COMPLETED") {
      return res.status(400).json({
        error: "Current round is not completed. Cannot move to next round.",
      });
    }

    const nextRoundIndex = currentRoundIndex + 1;
    if (nextRoundIndex >= rounds.length) {
      return res.status(400).json({ error: "No further rounds available" });
    }

    session.currentRound = nextRoundIndex + 1;
    session.currentRoundIndex = nextRoundIndex;
    session.currentQuestionIndex = 0;
    session.roundStatus = "IN_PROGRESS";
    session.state = INTERVIEW_STATES.IN_PROGRESS;
    session.currentQuestion = null;
    await session.save();
    await invalidateSessionAndSummaryCaches(userId, sessionId);

    const roundStart = await startRound(sessionId);

    return res.json({
      question: roundStart.question,
      status: "in_progress",
      interviewStatus: toClientInterviewStatus(session.state),
      roundStatus: session.roundStatus,
      currentRound: session.currentRound,
      currentQuestionIndex: session.currentQuestionIndex,
      roundType: roundStart.roundType,
      difficulty: roundStart.difficulty,
    });
  } catch (error) {
    console.error("❌ Error moving to next round:", error.message);
    return res.status(500).json({ error: "Failed to move to next round" });
  }
});

router.delete("/discard/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (!isSessionOwner(session, userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const deleted = await discardInProgressSession(sessionId);
    await Promise.all([
      invalidateSessionAndSummaryCaches(userId, sessionId),
      clearInterviewProcessing(sessionId),
    ]);
    if (!deleted) {
      // Idempotent discard: treat "already discarded/not found" as success.
      return res.json({ success: true, message: "No in-progress interview found to discard" });
    }

    return res.json({ success: true, message: "In-progress interview discarded" });
  } catch (error) {
    console.error("❌ Error discarding interview:", error.message);
    return res.status(500).json({ error: "Failed to discard interview" });
  }
});

router.get("/preview-plan/:companyId", async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      placementVisitType,
      placementCluster,
      placementYear: placementYearRaw,
      mergePlacementByType: mergePlacementByTypeRaw,
    } = req.query;
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }

    const mergePlacementByType = parseMergePlacementByType(mergePlacementByTypeRaw);
    const norm = normalizeVisitKeyParts(
      placementVisitType,
      mergePlacementByType ? "" : placementCluster
    );
    const placementYear = mergePlacementByType
      ? normalizePlacementVisitYear(undefined)
      : normalizePlacementVisitYear(placementYearRaw);
    const loaded = await getInterviewMergedCompanyPayload(
      String(companyId),
      norm.type,
      norm.cluster,
      placementYear,
      mergePlacementByType
    );
    if (!loaded?.staticRow || !loaded.merged) {
      return res.status(404).json({ error: "Company not found" });
    }
    const companyData = loaded.merged;

    const plan = await generateInterviewPlan(companyData);
    console.info("📋 Interview preview generated", {
      companyId,
      totalRounds: plan?.totalRounds || 0,
      roundsPlanCount: Array.isArray(plan?.roundsPlan) ? plan.roundsPlan.length : 0,
      placementVisitType: norm.type,
      placementCluster: norm.cluster,
      placementYear: loaded.placementYear,
      mergePlacementByType,
    });
    return res.json({
      ...plan,
      placementVisitType: norm.type,
      placementCluster: norm.cluster,
      placementYear: loaded.placementYear,
      mergePlacementByType,
    });
  } catch (error) {
    console.error("❌ Error generating interview preview:", error.message);
    return res.status(500).json({ error: "Failed to generate interview preview" });
  }
});

export default router;

