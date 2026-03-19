import express from "express";
import Company from "../models/Company.js";
import {
  createSession,
  getSession,
  getInProgressSession,
  getUserSessions,
  updateSession,
  discardInProgressSession,
} from "../services/interviewSessionService.js";
import { generateInterviewPlan, runInterviewStep } from "../services/interviewEngine.js";

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
    let stepResponse = null;
    const sessionState = {
      ...session.toObject(),
      companyData,
    };

    if (isAlreadyInitialized) {
      stepResponse = {
        question: session.currentQuestion,
        status: session.status || "in_progress",
      };
    } else {
      stepResponse = await runInterviewStep(sessionState, null);
      await updateSession(session._id, {
        currentRound: sessionState.currentRound,
        roundsPlan: sessionState.roundsPlan,
        roundsDetails: sessionState.roundsDetails,
        totalRounds: sessionState.totalRounds,
        currentRoundIndex: sessionState.currentRoundIndex,
        difficultyLevel: sessionState.difficultyLevel,
        currentQuestion: stepResponse.question,
        status: stepResponse.status,
      });
    }

    return res.status(createdNewSession ? 201 : 200).json({
      sessionId: session._id,
      question: stepResponse.question,
      status: stepResponse.status,
      resumed: isAlreadyInitialized,
      currentRound: sessionState.currentRound || session.currentRound || null,
      roundsPlan: sessionState.roundsPlan || session.roundsPlan || [],
      roundsDetails: sessionState.roundsDetails || session.roundsDetails || [],
      totalRounds: sessionState.totalRounds || session.totalRounds || 0,
      currentRoundIndex: sessionState.currentRoundIndex || session.currentRoundIndex || 0,
      difficultyLevel: sessionState.difficultyLevel || session.difficultyLevel || null,
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
      return res.status(404).json({ error: "No in-progress interview found" });
    }

    return res.json({
      sessionId: session._id,
      question: session.currentQuestion || null,
      status: session.status,
      currentRound: session.currentRound || null,
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

    if (!sessionId || typeof answer !== "string") {
      return res.status(400).json({
        error: "sessionId and answer are required",
      });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const companyData = await Company.findById(session.companyId)
      .select(
        "name onlineQuestions interviewQuestions interviewProcess Must_Do_Topics interview_questions prev_coding_ques"
      )
      .lean();

    const sessionState = {
      ...session.toObject(),
      companyData: companyData || {},
    };

    const stepResponse = await runInterviewStep(sessionState, answer);

    await updateSession(sessionId, {
      history: sessionState.history,
      currentRound: sessionState.currentRound,
      roundsPlan: sessionState.roundsPlan,
      roundsDetails: sessionState.roundsDetails,
      totalRounds: sessionState.totalRounds,
      currentRoundIndex: sessionState.currentRoundIndex,
      difficultyLevel: sessionState.difficultyLevel,
      currentQuestion: sessionState.currentQuestion,
      status: stepResponse.status,
      finalReport: stepResponse.report || null,
    });

    return res.json({
      ...stepResponse,
      currentRound: sessionState.currentRound || null,
      roundsPlan: sessionState.roundsPlan || [],
      roundsDetails: sessionState.roundsDetails || [],
      totalRounds: sessionState.totalRounds || 0,
      currentRoundIndex: sessionState.currentRoundIndex || 0,
      difficultyLevel: sessionState.difficultyLevel || null,
    });
  } catch (error) {
    console.error("❌ Error submitting interview answer:", error.message);
    return res.status(500).json({ error: "Failed to submit answer" });
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
      return res.status(404).json({ error: "No in-progress session found to discard" });
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
    return res.json(plan);
  } catch (error) {
    console.error("❌ Error generating interview preview:", error.message);
    return res.status(500).json({ error: "Failed to generate interview preview" });
  }
});

export default router;

