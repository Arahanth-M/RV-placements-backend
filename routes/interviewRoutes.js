import express from "express";
import Company from "../models/Company.js";
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
} from "../services/interviewSessionService.js";
import { generateInterviewPlan } from "../services/interviewEngine.js";
import { interviewQueue } from "../services/queues/interviewQueue.js";
import { EVALUATE_ANSWER } from "../services/queues/jobTypes.js";
import { buildInterviewTips } from "../utils/interviewTips.js";
import { INTERVIEW_STATES } from "../services/interviewStateMachine.js";
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

router.post("/start-interview", validateRequest(interviewStartSchema), async (req, res) => {
  try {
    const { companyId } = req.body;
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!companyId) {
      return res.status(400).json({
        error: "companyId is required",
      });
    }

    const companyData = await Company.findById(companyId)
      .select(
        "name onlineQuestions interviewQuestions interviewProcess Must_Do_Topics interview_questions prev_coding_ques"
      )
      .lean();

    if (!companyData) {
      return res.status(404).json({ error: "Company not found" });
    }

    let session = await getInProgressSession(userId, companyId);
    const createdNewSession = !session;
    if (!session) {
      session = await createSession(userId, companyId);
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
    const { companyId } = req.query;
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!companyId) {
      return res.status(400).json({
        error: "companyId is required",
      });
    }

    const session = await getInProgressSession(userId, companyId);
    if (!session) {
      return res.json({
        resumable: false,
        sessionId: null,
        question: null,
        status: "idle",
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
    if (cached) {
      recordLatencyMetric("sessions", Date.now() - startedAt);
      console.info("[interview-sessions] cache hit", {
        userId,
        page,
        limit,
        durationMs: Date.now() - startedAt,
      });
      return res.json(cached);
    }

    const { items, pagination } = await getUserSessionSummariesPaginated(userId, page, limit);
    const payload = {
      items: items.map((session) => ({
        _id: session._id,
        userId: session.userId,
        companyId: session.companyId?._id || session.companyId || null,
        companyName: session.companyId?.name || "Unknown Company",
        companyType: session.companyId?.type || "",
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
      })),
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
      recordLatencyMetric("sessionDetail", Date.now() - startedAt);
      console.info("[interview-session-detail] cache hit", {
        sessionId,
        durationMs: Date.now() - startedAt,
      });
      return res.json(cached);
    }

    const session = await getUserSessionDetail(userId, sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const payload = {
      _id: session._id,
      userId: session.userId,
      companyId: session.companyId?._id || session.companyId || null,
      companyName: session.companyId?.name || "Unknown Company",
      companyType: session.companyId?.type || "",
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
    const selectedTips = buildInterviewTips({
      roundType,
      difficulty: currentRoundDoc?.difficulty || session.difficultyLevel,
      currentQuestion: effectiveCurrentQuestion || prevQuestion?.question || "",
      companyName: session.companyId?.name || "",
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

    return res.json({
      status: toClientStatus(session.state),
      currentRound: session.currentRound,
      currentQuestion: effectiveCurrentQuestion,
      currentQuestionIndex: session.currentQuestionIndex,
      lastScore: prevQuestion?.score ?? null,
      lastFeedback: prevQuestion?.feedback ?? null,
      lastCorrectness: prevQuestion?.evaluationTrace?.verdict ?? null,
      lastRelevance: toRelevanceLabel(prevQuestion?.evaluationTrace?.relevance),
      roundStatus: currentRoundDoc?.status ?? session.roundStatus ?? null,
      interviewStatus: toClientInterviewStatus(session.state),
      roundType: roundType ?? null,
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
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }

    const companyData = await Company.findById(companyId)
      .select(
        "name onlineQuestions interviewQuestions interviewProcess Must_Do_Topics interview_questions prev_coding_ques"
      )
      .lean();

    if (!companyData) {
      return res.status(404).json({ error: "Company not found" });
    }

    const plan = await generateInterviewPlan(companyData);
    console.info("📋 Interview preview generated", {
      companyId,
      totalRounds: plan?.totalRounds || 0,
      roundsPlanCount: Array.isArray(plan?.roundsPlan) ? plan.roundsPlan.length : 0,
    });
    return res.json(plan);
  } catch (error) {
    console.error("❌ Error generating interview preview:", error.message);
    return res.status(500).json({ error: "Failed to generate interview preview" });
  }
});

export default router;

