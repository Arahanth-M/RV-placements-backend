import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import { connectRedis, redisUrl } from "../src/utils/redisClient.js";
import { connectDB } from "../config/db.js";
import { config } from "../config/constants.js";
import { EVALUATE_ANSWER, INTERVIEW_QUEUE } from "../services/queues/jobTypes.js";
import { evaluateAnswer } from "../services/mcp/evaluateAnswer.js";
import { generateQuestion } from "../services/mcp/generateQuestion.js";
import {
  getSession,
  generateRoundFeedback as generateRoundFeedbackForRound,
  resolveInterviewMergedCompanyForSession,
} from "../services/interviewSessionService.js";
import { generateFinalReport } from "../services/interviewEngine.js";
import { callLLM } from "../services/llmClient.js";
import { getCompanyContext } from "../services/mcp/getCompanyContext.js";
import { getEmbedding } from "../utils/embedding.js";
import { handleEvaluationResult } from "../services/interviewOrchestrator.js";
import {
  assertValidTransition,
  INTERVIEW_STATES,
} from "../services/interviewStateMachine.js";
import {
  clearInterviewProcessing,
  invalidateInterviewDetail,
  invalidateInterviewSummaries,
  markInterviewProcessing,
} from "../services/interviewCache.js";
import {
  mirrorLegacyAttemptsIntoSlot,
  normalizedQuestionAttempts,
  resolvedQuestionScore,
} from "../utils/interviewQuestionAttempts.js";

await connectDB(config.MONGO_URI);
await connectRedis().catch(() => {});

const connection = redisUrl ? { url: redisUrl } : {};
const toClientStatus = (state) =>
  state === INTERVIEW_STATES.INTERVIEW_COMPLETE ? "completed" : "in_progress";
const toClientInterviewStatus = (state) =>
  state === INTERVIEW_STATES.INTERVIEW_COMPLETE ? "COMPLETED" : "IN_PROGRESS";

/** Reserved for tests / future wiring. */
export const interviewWorkerDeps = {
  evaluateAnswer,
  generateQuestion,
  getSession,
};

function syncStoredRoundIndexFromCurrentRound(sess) {
  const rounds = Array.isArray(sess.rounds) ? sess.rounds : [];
  const currentRoundNumber = Number(sess.currentRound) || 1;
  sess.currentRoundIndex = Math.max(0, Math.min(rounds.length - 1, currentRoundNumber - 1));
}

/**
 * Same control flow as routes/interviewRoutes.js POST /submit-answer (heavy path).
 * Returns { httpStatus, body } for the HTTP layer to send after waitUntilFinished.
 */
async function processEvaluateAnswerJob(sessionId, answer) {
  const trimmedAnswer = typeof answer === "string" ? answer.trim() : "";

  // 1) Fetch session
  const session = await getSession(sessionId);
  if (!session) {
    return { httpStatus: 404, body: { error: "Session not found" } };
  }
  if (session.state === INTERVIEW_STATES.INTERVIEW_COMPLETE) {
    return { httpStatus: 400, body: { error: "Interview already completed" } };
  }
  if (!Array.isArray(session.rounds) || session.rounds.length === 0) {
    return { httpStatus: 400, body: { error: "Interview rounds are not initialized" } };
  }

  // 2) Identify current round and current question (currentRound is 1-based; index = round - 1, clamped)
  const currentRoundNumber = Number(session.currentRound) || 1;
  const currentRoundIndex = Math.max(
    0,
    Math.min(session.rounds.length - 1, currentRoundNumber - 1)
  );
  const currentRound = session.rounds[currentRoundIndex];
  if (!currentRound) {
    return { httpStatus: 400, body: { error: "Current round not found" } };
  }

  const currentQuestionIndex = Number(session.currentQuestionIndex) || 0;
  const currentQuestionEntry = currentRound.questions?.[currentQuestionIndex];
  const currentQuestion = currentQuestionEntry?.question || session.currentQuestion;
  if (!currentQuestion) {
    return { httpStatus: 400, body: { error: "Current question not found for this round" } };
  }

  const existingSlot = currentRound.questions?.[currentQuestionIndex];
  let mirroredLegacy = false;
  if (existingSlot) {
    mirroredLegacy = mirrorLegacyAttemptsIntoSlot(existingSlot);
  }
  if (
    existingSlot &&
    typeof existingSlot.answer === "string" &&
    existingSlot.answer.trim() !== ""
  ) {
    if (mirroredLegacy) {
      session.markModified("rounds");
      await session.save();
    }
    console.log(
      "[interviewWorker] idempotent skip — answer already exists for current question slot",
      {
        sessionId,
        currentQuestionIndex,
      }
    );
    return {
      httpStatus: 200,
      body: {
        question: session.currentQuestion,
        feedback: existingSlot.feedback || "",
        score: existingSlot.score ?? null,
        status: toClientStatus(session.state),
        interviewStatus: toClientInterviewStatus(session.state),
        roundStatus: session.roundStatus,
        currentRound: session.currentRound,
        currentQuestionIndex: session.currentQuestionIndex,
      },
    };
  }

  // Company context for MCP tools
  const companyData = (await resolveInterviewMergedCompanyForSession(session)) ?? null;
  const companyContext = await getCompanyContext(companyData || {});

  const questionSlot = currentRound.questions[currentQuestionIndex];
  if (questionSlot && Array.isArray(questionSlot.expectedPoints)) {
    let didGenerateEmbeddings = false;
    for (let point of questionSlot.expectedPoints) {
      if (!point.embedding || point.embedding.length === 0) {
        point.embedding = await getEmbedding(point.text);
        didGenerateEmbeddings = true;
      }
    }
    if (didGenerateEmbeddings) {
      session.markModified("rounds");
      await session.save();
    }
  }

  // 3) Call LLM to get reasoning ONLY (no scoring / no flow decisions)
  const reasoningMessages = [
    {
      role: "system",
      content: "Return reasoning text only. Do not provide score or control-flow decisions.",
    },
    {
      role: "user",
      content: `Question: ${currentQuestion}
Candidate answer: ${trimmedAnswer}
Round type: ${currentRound.type}
Difficulty: ${currentRound.difficulty}
Company context: ${JSON.stringify(companyContext)}

Give brief reasoning on answer quality, technical correctness, clarity, and gaps.`,
    },
  ];
  let llmReasoning = "";
  try {
    llmReasoning = await callLLM(reasoningMessages);
  } catch (error) {
    // Keep submit-answer resilient even if provider/network has transient issues.
    console.warn(
      "⚠️ LLM reasoning call failed, continuing with fallback reasoning:",
      error?.message || error
    );
    llmReasoning = "";
  }

  const stateBeforeEval = session.state;

  assertValidTransition(session.state, INTERVIEW_STATES.EVALUATING);
  session.state = INTERVIEW_STATES.EVALUATING;
  console.log("State → EVALUATING");
  await session.save();

  const questionObj = currentRound.questions[currentQuestionIndex];
  mirrorLegacyAttemptsIntoSlot(questionObj);
  if (normalizedQuestionAttempts(questionObj).length >= 2) {
    session.state = stateBeforeEval;
    await session.save();
    return {
      httpStatus: 400,
      body: {
        error: "Maximum submission attempts reached for this question (initial answer plus one reattempt).",
      },
    };
  }

  // 4) MCP evaluateAnswer
  let evaluation;
  try {
    evaluation = await evaluateAnswer({
      answer: trimmedAnswer,
      question: currentQuestion,
      companyContext,
      llmReasoning,
      expectedPoints: questionObj?.expectedPoints,
    });
  } catch (error) {
    console.warn("⚠️ evaluateAnswer failed, using fallback evaluation:", error?.message || error);
    evaluation = {
      score: 5,
      type: "general",
      feedback:
        "Thanks for the response. I could not evaluate this answer fully right now, so this is a neutral score. Please continue to the next question.",
      verdict: "partial",
      evaluationTrace: {
        scoringVersion: "fallback",
        questionType: "general",
        expectedAnswerMode: "conceptual",
        verdict: "partial",
        confidence: 0.3,
        relevance: 0.5,
        coverage: 0.5,
        correctness: 0.5,
        communication: 0.5,
        matchedRubricPoints: [],
        missingRubricPoints: [],
        criticalMisses: [],
        subscores: {},
      },
    };
  }

  const evaluationResult = {
    score: evaluation.score,
    feedback: evaluation.feedback,
  };
  const decision = await handleEvaluationResult(session, evaluationResult);
  if (!decision || !decision.action) {
    throw new Error("Invalid orchestrator decision");
  }
  console.log("Orchestrator Decision:", decision);
  if (decision.action === "NEXT_QUESTION") {
    assertValidTransition(session.state, INTERVIEW_STATES.ROUND_ACTIVE);
    session.state = INTERVIEW_STATES.ROUND_ACTIVE;
    await session.save();
    console.log("State → ROUND_ACTIVE");
  }

  // 5) Save answer + score + feedback
  if (!Array.isArray(currentRound.questions)) {
    currentRound.questions = [];
  }
  if (!currentRound.questions[currentQuestionIndex]) {
    currentRound.questions[currentQuestionIndex] = {
      question: currentQuestion,
      answer: "",
      score: null,
      feedback: "",
      evaluationTrace: null,
      attempts: [],
      expectedPoints: Array.isArray(currentQuestionEntry?.expectedPoints)
        ? currentQuestionEntry.expectedPoints
        : [],
    };
  }
  currentRound.questions[currentQuestionIndex].answer = trimmedAnswer;
  currentRound.questions[currentQuestionIndex].score = evaluation.score;
  currentRound.questions[currentQuestionIndex].feedback = evaluation.feedback;
  currentRound.questions[currentQuestionIndex].evaluationTrace = evaluation.evaluationTrace || null;

  if (!Array.isArray(currentRound.questions[currentQuestionIndex].attempts)) {
    currentRound.questions[currentQuestionIndex].attempts = [];
  }
  currentRound.questions[currentQuestionIndex].attempts.push({
    answer: trimmedAnswer,
    score: evaluation.score,
    feedback: evaluation.feedback,
    evaluationTrace: evaluation.evaluationTrace || null,
  });

  // 6) Increment currentQuestionIndex
  const nextQuestionIndex = currentQuestionIndex + 1;
  session.currentQuestionIndex = nextQuestionIndex;
  session.roundStatus = "IN_PROGRESS";
  currentRound.status = "IN_PROGRESS";

  // 7) Decision branch: keep existing next-question execution logic.
  if (decision.action === "NEXT_QUESTION") {
    const roundHistory = Array.isArray(currentRound.questions)
      ? currentRound.questions.slice(0, nextQuestionIndex).map((item) => ({
          question: item?.question || "",
          answer: item?.answer || "",
          feedback: item?.feedback || "",
          score: item?.score,
        }))
      : [];

    const recentScores = (Array.isArray(currentRound.questions) ? currentRound.questions : [])
      .slice(0, nextQuestionIndex)
      .map((item) => Number(item?.score))
      .filter((value) => Number.isFinite(value))
      .slice(-2);

    let { question, expectedPoints, expectedAnswerMode } = await generateQuestion({
      userId: String(session.userId || ""),
      companyContext,
      roundType: currentRound.type,
      roundAbout: currentRound.about,
      difficulty: currentRound.difficulty,
      previousQuestion: currentQuestion,
      previousAnswer: trimmedAnswer,
      previousFeedback: evaluation.feedback,
      previousScore: evaluation.score,
      previousEvaluation: {
        confidence: evaluation?.evaluationTrace?.confidence,
        criticalMisses: evaluation?.evaluationTrace?.criticalMisses || [],
        recentScores,
      },
      roundHistory,
      placementVisitType: session.placementVisitType,
      placementCluster: session.placementCluster,
      placementYear: session.placementYear,
      mergePlacementByType: session.mergePlacementByType === true,
    });
    if (!question || !String(question).trim()) {
      question = `Let's go deeper — how would you refine or extend your approach for this ${currentRound.type || "technical"} question?`;
      expectedPoints = [];
      expectedAnswerMode = "conceptual";
    }

    const nextExpectedPointsStored = (Array.isArray(expectedPoints) ? expectedPoints : []).map(
      (p) => ({
        text: p?.text || "",
        category: p?.category || "coverage",
        importance: p?.importance || "mustHave",
        expectedAnswerMode: p?.expectedAnswerMode || expectedAnswerMode || "conceptual",
        embedding: Array.isArray(p?.embedding) ? p.embedding : [],
      })
    );

    if (!currentRound.questions[nextQuestionIndex]) {
      currentRound.questions[nextQuestionIndex] = {
        question,
        answer: "",
        score: null,
        feedback: "",
        evaluationTrace: null,
        expectedPoints: nextExpectedPointsStored,
      };
    } else {
      currentRound.questions[nextQuestionIndex].question = question;
      currentRound.questions[nextQuestionIndex].answer = "";
      currentRound.questions[nextQuestionIndex].score = null;
      currentRound.questions[nextQuestionIndex].feedback = "";
      currentRound.questions[nextQuestionIndex].evaluationTrace = null;
      currentRound.questions[nextQuestionIndex].expectedPoints = nextExpectedPointsStored;
    }

    session.currentQuestion = question;
    syncStoredRoundIndexFromCurrentRound(session);
    session.markModified("rounds");
    session.markModified("currentQuestion");
    session.markModified("currentQuestionIndex");
    session.markModified("roundStatus");
    session.markModified("state");
    session.markModified("currentRoundIndex");
    await session.save();

    console.info("[interviewWorker] saved next question", {
      sessionTail: String(sessionId).slice(-8),
      currentQuestionIndex: session.currentQuestionIndex,
      nextQuestionLen: String(question || "").length,
    });
    console.log("Final Session State:", session.state);

    return {
      httpStatus: 200,
      body: {
        question,
        feedback: evaluation.feedback,
        score: evaluation.score,
        status: toClientStatus(session.state),
        interviewStatus: toClientInterviewStatus(session.state),
        roundStatus: session.roundStatus,
        currentRound: session.currentRound,
        currentQuestionIndex: session.currentQuestionIndex,
        roundType: currentRound.type ?? null,
      },
    };
  }

  // 8) Round completed -> persist completion, then generate round feedback
  currentRound.status = "COMPLETED";
  session.roundStatus = "COMPLETED";
  session.currentQuestion = null;
  syncStoredRoundIndexFromCurrentRound(session);
  session.markModified("rounds");
  session.markModified("currentQuestion");
  session.markModified("currentQuestionIndex");
  session.markModified("roundStatus");
  session.markModified("state");
  session.markModified("currentRoundIndex");
  await session.save();

  const roundFeedback = await generateRoundFeedbackForRound(sessionId, currentRound.roundNumber);

  // Reload to avoid version conflicts after the service saves the same document.
  const refreshedSession = await getSession(sessionId);
  if (!refreshedSession) {
    return { httpStatus: 404, body: { error: "Session not found" } };
  }

  const refreshedCurrentRoundNumber = Number(refreshedSession.currentRound) || 1;
  const refreshedRoundIndex = Math.max(
    0,
    Math.min(refreshedSession.rounds.length - 1, refreshedCurrentRoundNumber - 1)
  );
  const refreshedRound = refreshedSession.rounds[refreshedRoundIndex];
  const answeredScores = (refreshedRound?.questions || [])
    .map((item) => resolvedQuestionScore(item))
    .filter((value) => value != null && Number.isFinite(value));
  const roundAverageScore =
    answeredScores.length > 0
      ? Math.round(
          (answeredScores.reduce((sum, value) => sum + value, 0) / answeredScores.length) * 10
        ) / 10
      : 0;

  refreshedRound.feedback = {
    ...roundFeedback,
    score: roundAverageScore,
  };

  if (decision.action === "NEXT_ROUND") {
    assertValidTransition(refreshedSession.state, INTERVIEW_STATES.ROUND_COMPLETE);
    refreshedSession.state = INTERVIEW_STATES.ROUND_COMPLETE;
    await refreshedSession.save();
    console.log("State → ROUND_COMPLETE");

    // This worker does not initialize the next round question.
    // If/when a next round has already been initialized on this session, move to ROUND_ACTIVE.
    if (refreshedSession.currentQuestion) {
      assertValidTransition(refreshedSession.state, INTERVIEW_STATES.ROUND_ACTIVE);
      refreshedSession.state = INTERVIEW_STATES.ROUND_ACTIVE;
      await refreshedSession.save();
      console.log("State → ROUND_ACTIVE (new round)");
    }
  }

  if (decision.action === "INTERVIEW_COMPLETE") {
    assertValidTransition(refreshedSession.state, INTERVIEW_STATES.ROUND_COMPLETE);
    refreshedSession.state = INTERVIEW_STATES.ROUND_COMPLETE;
    await refreshedSession.save();
    console.log("State → ROUND_COMPLETE");

    assertValidTransition(refreshedSession.state, INTERVIEW_STATES.INTERVIEW_COMPLETE);
    refreshedSession.state = INTERVIEW_STATES.INTERVIEW_COMPLETE;
    await refreshedSession.save();
    console.log("State → INTERVIEW_COMPLETE");

    try {
      refreshedSession.finalReport = await generateFinalReport(refreshedSession);
      console.log(`✅ [interviewWorker] Final report generated for session ${sessionId}`);
    } catch (reportError) {
      console.error(`❌ [interviewWorker] Final report generation failed for session ${sessionId}:`, reportError?.message || reportError);
      const sessionScores = (refreshedSession.rounds || [])
        .flatMap((r) => (Array.isArray(r?.questions) ? r.questions : []))
        .map((q) => resolvedQuestionScore(q))
        .filter((v) => v != null && Number.isFinite(v));
      const sessionAvgOverall =
        sessionScores.length > 0
          ? Math.round(
              (sessionScores.reduce((sum, v) => sum + v, 0) / sessionScores.length) * 10
            ) / 10
          : roundAverageScore;
      // Fallback with minimal info so we don't save a completely null report if possible
      refreshedSession.finalReport = {
        overallScore: sessionAvgOverall,
        summaryFeedback: "Your interview is complete. Feedback is being generated and will be available in your history shortly.",
        summary: "Interview complete.",
      };
    }
  }

  syncStoredRoundIndexFromCurrentRound(refreshedSession);
  refreshedSession.markModified("rounds");
  refreshedSession.markModified("currentQuestion");
  refreshedSession.markModified("state");
  refreshedSession.markModified("finalReport");
  refreshedSession.markModified("currentRoundIndex");
  refreshedSession.markModified("roundStatus");
  await refreshedSession.save();
  session.state = refreshedSession.state;
  console.log("Final Session State:", session.state);

  return {
    httpStatus: 200,
    body: {
      question: null,
      feedback: evaluation.feedback,
      score: evaluation.score,
      status: toClientStatus(refreshedSession.state),
      interviewStatus: toClientInterviewStatus(refreshedSession.state),
      roundStatus: refreshedSession.roundStatus,
      currentRound: refreshedSession.currentRound,
      currentQuestionIndex: refreshedSession.currentQuestionIndex,
      roundType: refreshedRound?.type ?? null,
      roundCompleted: true,
      roundFeedback: refreshedRound.feedback || {},
      nextRoundAvailable: decision.action === "NEXT_ROUND",
      report:
        decision.action === "INTERVIEW_COMPLETE"
          ? refreshedSession.finalReport || null
          : null,
    },
  };
}

const processor = async (job) => {
  console.log("[interviewWorker] job received", {
    id: job.id,
    name: job.name,
    data: job.data,
    attemptsMade: job.attemptsMade,
  });

  if (job.name === EVALUATE_ANSWER) {
    const { sessionId, answer } = job.data || {};
    await markInterviewProcessing(sessionId);
    try {
      const result = await processEvaluateAnswerJob(sessionId, answer);
      return result;
    } finally {
      await clearInterviewProcessing(sessionId);
      await invalidateInterviewDetail(sessionId);
      try {
        const latest = await getSession(sessionId);
        if (latest?.userId) {
          await invalidateInterviewSummaries(latest.userId);
        }
      } catch (err) {
        console.warn("[interviewWorker] cache invalidation after job failed:", err?.message || err);
      }
    }
  }

  if (job.name && job.name !== EVALUATE_ANSWER) {
    console.warn(
      "[interviewWorker] unexpected job name (handler not implemented):",
      job.name,
      "expected:",
      EVALUATE_ANSWER
    );
  }
};

const WORKER_COUNT = 2;
const WORKER_CONCURRENCY = 10;

function attachWorkerListeners(worker, index) {
  const workerLabel = `interviewWorker#${index + 1}`;

  worker.on("completed", (job) => {
    console.log(`[${workerLabel}] completed`, { id: job.id, name: job.name });
  });

  worker.on("failed", (job, err) => {
    console.error(`[${workerLabel}] failed`, {
      id: job?.id,
      name: job?.name,
      attemptsMade: job?.attemptsMade,
      error: err?.message || err,
      stack: err?.stack,
    });
  });

  worker.on("error", (err) => {
    console.error(`[${workerLabel}] worker error:`, err?.message || err, err?.stack);
  });

  worker.on("stalled", (jobId) => {
    console.warn(`[${workerLabel}] stalled job:`, jobId);
  });
}

export const interviewWorkers = Array.from({ length: WORKER_COUNT }, (_, index) => {
  const worker = new Worker(INTERVIEW_QUEUE, processor, {
    connection,
    concurrency: WORKER_CONCURRENCY,
  });
  attachWorkerListeners(worker, index);
  return worker;
});

// Backward-compatible export for modules expecting a single worker instance.
export const interviewWorker = interviewWorkers[0];
