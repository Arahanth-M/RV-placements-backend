import express from "express";
import Company from "../models/Company.js";
import {
  createSession,
  getSession,
  getInProgressSession,
  getUserSessions,
  updateSession,
  discardInProgressSession,
  generateRoundFeedback as generateRoundFeedbackForRound,
  startRound,
} from "../services/interviewSessionService.js";
import { generateFinalReport, generateInterviewPlan } from "../services/interviewEngine.js";
import { callLLM } from "../services/llmClient.js";
import { getCompanyContext } from "../services/mcp/getCompanyContext.js";
import { generateQuestion } from "../services/mcp/generateQuestion.js";
import { evaluateAnswer } from "../services/mcp/evaluateAnswer.js";

const router = express.Router();

router.post("/start-interview", async (req, res) => {
  try {
    const { userId, companyId } = req.body;

    if (!userId || !companyId) {
      return res.status(400).json({
        error: "userId and companyId are required",
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
        status: session.status || "in_progress",
        currentRound: session.currentRound || 1,
        currentQuestionIndex: session.currentQuestionIndex ?? 0,
        roundStatus: session.roundStatus || "IN_PROGRESS",
        interviewStatus: session.interviewStatus || "IN_PROGRESS",
        rounds: session.rounds || [],
        roundsPlan: session.roundsPlan || [],
        roundsDetails: session.roundsDetails || [],
        totalRounds: session.totalRounds || 0,
        currentRoundIndex: session.currentRoundIndex || 0,
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
        interviewStatus: plan.interviewStatus,
        status: "in_progress",
      });

      const roundStart = await startRound(session._id);
      const refreshedSession = await getSession(session._id);
      responsePayload = {
        question: roundStart.question,
        status: refreshedSession?.status || "in_progress",
        currentRound: refreshedSession?.currentRound || 1,
        currentQuestionIndex: refreshedSession?.currentQuestionIndex ?? 0,
        roundStatus: refreshedSession?.roundStatus || "IN_PROGRESS",
        interviewStatus: refreshedSession?.interviewStatus || "IN_PROGRESS",
        rounds: refreshedSession?.rounds || [],
        roundsPlan: refreshedSession?.roundsPlan || [],
        roundsDetails: refreshedSession?.roundsDetails || [],
        totalRounds: refreshedSession?.totalRounds || plan.totalRounds || 0,
        currentRoundIndex: refreshedSession?.currentRoundIndex || 0,
        difficultyLevel:
          refreshedSession?.rounds?.[0]?.difficulty || refreshedSession?.difficultyLevel || null,
      };
    }

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
    const { userId, companyId } = req.query;

    if (!userId || !companyId) {
      return res.status(400).json({
        error: "userId and companyId are required",
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
      status: session.status,
      currentRound: session.currentRound || null,
      currentQuestionIndex: session.currentQuestionIndex || 0,
      roundStatus: session.roundStatus || "IN_PROGRESS",
      interviewStatus: session.interviewStatus || "IN_PROGRESS",
      rounds: session.rounds || [],
      roundsPlan: session.roundsPlan || [],
      roundsDetails: session.roundsDetails || [],
      totalRounds: session.totalRounds || 0,
      currentRoundIndex: session.currentRoundIndex || 0,
      difficultyLevel: session.difficultyLevel || null,
      historyCount: Array.isArray(session.history) ? session.history.length : 0,
    });
  } catch (error) {
    console.error("❌ Error resuming interview:", error.message);
    return res.status(500).json({ error: "Failed to fetch resumable interview" });
  }
});

router.get("/sessions/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const sessions = await getUserSessions(userId);
    return res.json(
      sessions.map((session) => ({
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
        interviewStatus: session.interviewStatus || "IN_PROGRESS",
        rounds: session.rounds || [],
        roundsPlan: session.roundsPlan || [],
        roundsDetails: session.roundsDetails || [],
        totalRounds: session.totalRounds || 0,
        currentRoundIndex: session.currentRoundIndex || 0,
        difficultyLevel: session.difficultyLevel || "",
        currentQuestion: session.currentQuestion || null,
        status: session.status,
        finalReport: session.finalReport || null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }))
    );
  } catch (error) {
    console.error("❌ Error fetching interview sessions:", error.message);
    return res.status(500).json({ error: "Failed to fetch interview history" });
  }
});

router.post("/submit-answer", async (req, res) => {
  try {
    const { sessionId, answer } = req.body;

    if (!sessionId || typeof answer !== "string" || !answer.trim()) {
      return res.status(400).json({
        error: "sessionId and answer are required",
      });
    }

    // 1) Fetch session
    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (session.interviewStatus === "COMPLETED") {
      return res.status(400).json({ error: "Interview already completed" });
    }
    if (!Array.isArray(session.rounds) || session.rounds.length === 0) {
      return res.status(400).json({ error: "Interview rounds are not initialized" });
    }

    // 2) Identify current round and current question
    const roundNumber = Number(session.currentRound) || 1;
    const roundIndex = Math.max(0, Math.min(session.rounds.length - 1, roundNumber - 1));
    const currentRound = session.rounds[roundIndex];
    if (!currentRound) {
      return res.status(400).json({ error: "Current round not found" });
    }

    const currentQuestionIndex = Number(session.currentQuestionIndex) || 0;
    const currentQuestionEntry = currentRound.questions?.[currentQuestionIndex];
    const currentQuestion = currentQuestionEntry?.question || session.currentQuestion;
    if (!currentQuestion) {
      return res.status(400).json({ error: "Current question not found for this round" });
    }

    const trimmedAnswer = answer.trim();

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
    const llmReasoning = await callLLM(reasoningMessages);

    // 4) MCP evaluateAnswer
    const evaluation = await evaluateAnswer({
      answer: trimmedAnswer,
      question: currentQuestion,
      companyContext,
      llmReasoning,
    });

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

      const nextQuestion = await generateQuestion({
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
      session.markModified("rounds");
      await session.save();

      return res.json({
        question: nextQuestion,
        feedback: evaluation.feedback,
        score: evaluation.score,
        status: "in_progress",
        interviewStatus: session.interviewStatus,
        roundStatus: session.roundStatus,
        currentRound: session.currentRound,
        currentQuestionIndex: session.currentQuestionIndex,
      });
    }

    // 8) Round completed -> persist completion, then generate round feedback
    currentRound.status = "COMPLETED";
    session.roundStatus = "COMPLETED";
    session.currentQuestion = null;
    session.markModified("rounds");
    await session.save();

    const roundFeedback = await generateRoundFeedbackForRound(
      sessionId,
      currentRound.roundNumber
    );

    // Reload to avoid version conflicts after the service saves the same document.
    const refreshedSession = await getSession(sessionId);
    if (!refreshedSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    const refreshedRoundIndex = Math.max(
      0,
      Math.min(refreshedSession.rounds.length - 1, roundNumber - 1)
    );
    const refreshedRound = refreshedSession.rounds[refreshedRoundIndex];
    const answeredScores = (refreshedRound?.questions || [])
      .map((item) => Number(item?.score))
      .filter((value) => Number.isFinite(value));
    const roundAverageScore =
      answeredScores.length > 0
        ? Math.round(
            (answeredScores.reduce((sum, value) => sum + value, 0) /
              answeredScores.length) *
              10
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

    refreshedSession.markModified("rounds");
    await refreshedSession.save();

    return res.json({
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
    });
  } catch (error) {
    console.error("❌ Error submitting interview answer:", error.message);
    return res.status(500).json({ error: "Failed to submit answer" });
  }
});

router.post("/move-to-next-round", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (session.interviewStatus === "COMPLETED") {
      return res.status(400).json({ error: "Interview already completed" });
    }

    const rounds = Array.isArray(session.rounds) ? session.rounds : [];
    if (rounds.length === 0) {
      return res.status(400).json({ error: "Rounds are not initialized" });
    }

    const currentRoundNumber = Number(session.currentRound) || 1;
    const currentIndex = Math.max(0, Math.min(rounds.length - 1, currentRoundNumber - 1));
    const currentRound = rounds[currentIndex];
    if (!currentRound || currentRound.status !== "COMPLETED") {
      return res.status(400).json({
        error: "Current round is not completed. Cannot move to next round.",
      });
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex >= rounds.length) {
      return res.status(400).json({ error: "No further rounds available" });
    }

    session.currentRound = nextIndex + 1;
    session.currentRoundIndex = nextIndex;
    session.currentQuestionIndex = 0;
    session.roundStatus = "IN_PROGRESS";
    session.interviewStatus = "IN_PROGRESS";
    session.currentQuestion = null;
    await session.save();

    const roundStart = await startRound(sessionId);

    return res.json({
      question: roundStart.question,
      status: "in_progress",
      interviewStatus: session.interviewStatus,
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
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const deleted = await discardInProgressSession(sessionId);
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

