import InterviewSession from "../models/InterviewSession.js";
import Company from "../models/Company.js";
import { getCompanyContext } from "./mcp/getCompanyContext.js";
import { generateQuestion } from "./mcp/generateQuestion.js";
import { generateRoundFeedback as generateRoundFeedbackMCP } from "./mcp/generateRoundFeedback.js";

const updateOptions = {
  new: true,
  runValidators: true,
};

export const createSession = async (userId, companyId) => {
  return InterviewSession.create({
    userId,
    companyId,
    status: "in_progress",
  });
};

export const getSession = async (sessionId) => {
  return InterviewSession.findById(sessionId);
};

export const getInProgressSession = async (userId, companyId) => {
  return InterviewSession.findOne({
    userId,
    companyId,
    status: "in_progress",
  }).sort({ updatedAt: -1 });
};

export const getUserSessions = async (userId) => {
  return InterviewSession.find({ userId })
    .populate("companyId", "name type")
    .sort({ updatedAt: -1 });
};

export const discardInProgressSession = async (sessionId) => {
  return InterviewSession.findOneAndDelete({
    _id: sessionId,
    status: "in_progress",
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
  const companyData = await Company.findById(session.companyId)
    .select(
      "name onlineQuestions interviewQuestions interviewProcess Must_Do_Topics interview_questions prev_coding_ques"
    )
    .lean();
  const companyContext = await getCompanyContext(companyData || {});
  const question = await generateQuestion({
    companyContext,
    roundType: currentRound.type,
    difficulty: currentRound.difficulty,
  });

  // 4) Store first question in round.questions
  currentRound.questions = [
    {
      question,
      answer: "",
      score: null,
      feedback: "",
    },
  ];

  // 5) Set currentQuestionIndex = 0
  session.currentQuestionIndex = 0;

  // 6) Set roundStatus = IN_PROGRESS
  currentRound.status = "IN_PROGRESS";
  session.roundStatus = "IN_PROGRESS";
  session.interviewStatus = "IN_PROGRESS";
  session.currentRound = roundNumber;
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
  const companyData = await Company.findById(session.companyId)
    .select(
      "name onlineQuestions interviewQuestions interviewProcess Must_Do_Topics interview_questions prev_coding_ques"
    )
    .lean();
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

