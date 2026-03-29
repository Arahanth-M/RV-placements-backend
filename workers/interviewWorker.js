import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import Company from "../models/Company.js";
import { connectRedis, redisUrl } from "../src/utils/redisClient.js";
import { connectDB } from "../config/db.js";
import { config } from "../config/constants.js";
import { EVALUATE_ANSWER, INTERVIEW_QUEUE } from "../services/queues/jobTypes.js";
import { evaluateAnswer } from "../services/mcp/evaluateAnswer.js";
import { generateQuestion } from "../services/mcp/generateQuestion.js";
import {
  getSession,
  generateRoundFeedback as generateRoundFeedbackForRound,
} from "../services/interviewSessionService.js";
import { generateFinalReport } from "../services/interviewEngine.js";
import { callLLM } from "../services/llmClient.js";
import { getCompanyContext } from "../services/mcp/getCompanyContext.js";

await connectDB(config.MONGO_URI);
await connectRedis().catch(() => {});

const connection = redisUrl ? { url: redisUrl } : {};

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
  if (session.interviewStatus === "COMPLETED") {
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
  if (
    existingSlot &&
    typeof existingSlot.answer === "string" &&
    existingSlot.answer.trim() !== ""
  ) {
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
        status: session.status || "in_progress",
        interviewStatus: session.interviewStatus,
        roundStatus: session.roundStatus,
        currentRound: session.currentRound,
        currentQuestionIndex: session.currentQuestionIndex,
      },
    };
  }

  // Company context for MCP tools
  const companyData = await Company.findById(session.companyId)
    .select(
      "name onlineQuestions interviewQuestions interviewProcess Must_Do_Topics interview_questions prev_coding_ques"
    )
    .lean();
  const companyContext = await getCompanyContext(companyData || {});

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

  // 4) MCP evaluateAnswer
  let evaluation;
  try {
    evaluation = await evaluateAnswer({
      answer: trimmedAnswer,
      question: currentQuestion,
      companyContext,
      llmReasoning,
    });
  } catch (error) {
    console.warn("⚠️ evaluateAnswer failed, using fallback evaluation:", error?.message || error);
    evaluation = {
      score: 5,
      type: "general",
      feedback:
        "Thanks for the response. I could not evaluate this answer fully right now, so this is a neutral score. Please continue to the next question.",
      verdict: "partial",
    };
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
    };
  }
  currentRound.questions[currentQuestionIndex].answer = trimmedAnswer;
  currentRound.questions[currentQuestionIndex].score = evaluation.score;
  currentRound.questions[currentQuestionIndex].feedback = evaluation.feedback;

  // 6) Increment currentQuestionIndex
  const nextQuestionIndex = currentQuestionIndex + 1;
  session.currentQuestionIndex = nextQuestionIndex;
  session.roundStatus = "IN_PROGRESS";
  session.interviewStatus = "IN_PROGRESS";
  currentRound.status = "IN_PROGRESS";

  const questionCount = Math.min(5, Math.max(3, Number(currentRound.questionCount) || 3));

  // 7) If more questions remain in the current round -> generate next
  if (nextQuestionIndex < questionCount) {
    const roundHistory = Array.isArray(currentRound.questions)
      ? currentRound.questions.slice(0, nextQuestionIndex).map((item) => ({
          question: item?.question || "",
          answer: item?.answer || "",
          feedback: item?.feedback || "",
          score: item?.score,
        }))
      : [];

    let nextQuestion = await generateQuestion({
      userId: String(session.userId || ""),
      companyContext,
      roundType: currentRound.type,
      roundAbout: currentRound.about,
      difficulty: currentRound.difficulty,
      previousQuestion: currentQuestion,
      previousAnswer: trimmedAnswer,
      previousFeedback: evaluation.feedback,
      previousScore: evaluation.score,
      roundHistory,
    });
    if (!nextQuestion || !String(nextQuestion).trim()) {
      nextQuestion = `Let's go deeper — how would you refine or extend your approach for this ${currentRound.type || "technical"} question?`;
    }

    if (!currentRound.questions[nextQuestionIndex]) {
      currentRound.questions[nextQuestionIndex] = {
        question: nextQuestion,
        answer: "",
        score: null,
        feedback: "",
      };
    } else {
      currentRound.questions[nextQuestionIndex].question = nextQuestion;
      currentRound.questions[nextQuestionIndex].answer = "";
      currentRound.questions[nextQuestionIndex].score = null;
      currentRound.questions[nextQuestionIndex].feedback = "";
    }

    session.currentQuestion = nextQuestion;
    syncStoredRoundIndexFromCurrentRound(session);
    session.markModified("rounds");
    session.markModified("currentQuestion");
    session.markModified("currentQuestionIndex");
    session.markModified("roundStatus");
    session.markModified("interviewStatus");
    session.markModified("currentRoundIndex");
    await session.save();

    console.info("[interviewWorker] saved next question", {
      sessionTail: String(sessionId).slice(-8),
      currentQuestionIndex: session.currentQuestionIndex,
      nextQuestionLen: String(nextQuestion || "").length,
    });

    return {
      httpStatus: 200,
      body: {
        question: nextQuestion,
        feedback: evaluation.feedback,
        score: evaluation.score,
        status: "in_progress",
        interviewStatus: session.interviewStatus,
        roundStatus: session.roundStatus,
        currentRound: session.currentRound,
        currentQuestionIndex: session.currentQuestionIndex,
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
  session.markModified("interviewStatus");
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
    .map((item) => Number(item?.score))
    .filter((value) => Number.isFinite(value));
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

  const hasNextRound = refreshedRoundIndex + 1 < refreshedSession.rounds.length;
  if (!hasNextRound) {
    refreshedSession.interviewStatus = "COMPLETED";
    refreshedSession.status = "completed";
    refreshedSession.finalReport = await generateFinalReport(refreshedSession);
  }

  syncStoredRoundIndexFromCurrentRound(refreshedSession);
  refreshedSession.markModified("rounds");
  refreshedSession.markModified("currentQuestion");
  refreshedSession.markModified("interviewStatus");
  refreshedSession.markModified("status");
  refreshedSession.markModified("finalReport");
  refreshedSession.markModified("currentRoundIndex");
  refreshedSession.markModified("roundStatus");
  await refreshedSession.save();

  return {
    httpStatus: 200,
    body: {
      question: null,
      feedback: evaluation.feedback,
      score: evaluation.score,
      status: refreshedSession.status || "in_progress",
      interviewStatus: refreshedSession.interviewStatus,
      roundStatus: refreshedSession.roundStatus,
      currentRound: refreshedSession.currentRound,
      currentQuestionIndex: refreshedSession.currentQuestionIndex,
      roundCompleted: true,
      roundFeedback: refreshedRound.feedback || {},
      nextRoundAvailable: hasNextRound,
      report: hasNextRound ? null : refreshedSession.finalReport || null,
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
    const result = await processEvaluateAnswerJob(sessionId, answer);
    return result;
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

export const interviewWorker = new Worker(INTERVIEW_QUEUE, processor, {
  connection,
  concurrency: 5,
});

interviewWorker.on("completed", (job) => {
  console.log("[interviewWorker] completed", { id: job.id, name: job.name });
});

interviewWorker.on("failed", (job, err) => {
  console.error("[interviewWorker] failed", {
    id: job?.id,
    name: job?.name,
    attemptsMade: job?.attemptsMade,
    error: err?.message || err,
    stack: err?.stack,
  });
});

interviewWorker.on("error", (err) => {
  console.error("[interviewWorker] worker error:", err?.message || err, err?.stack);
});

interviewWorker.on("stalled", (jobId) => {
  console.warn("[interviewWorker] stalled job:", jobId);
});
