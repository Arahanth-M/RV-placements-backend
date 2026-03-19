import { callLLM } from "./llmClient.js";
import { parseJSONResponse } from "../utils/parseJSONResponse.js";

const DEFAULT_ROUND = "technical_screening";
const DEFAULT_DIFFICULTY = "medium";
const DEFAULT_MAX_QUESTIONS = 5;
const DIFFICULTY_LEVELS = ["easy", "medium", "hard"];
const DEFAULT_ROUNDS_PLAN = ["online_assessment", "technical_interview", "hr_round"];
const MAX_COMPANY_ITEMS = 20;

const toSafeString = (value, fallback = "") => {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

const toSafeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(10, numeric));
};

const normalizeDifficultyAction = (value) => {
  const safeValue = toSafeString(value).toLowerCase();
  if (safeValue === "increase" || safeValue === "decrease" || safeValue === "same") {
    return safeValue;
  }
  return "same";
};

const normalizeNextAction = (value) => {
  const safeValue = toSafeString(value).toLowerCase();
  if (
    safeValue === "follow_up" ||
    safeValue === "next_question" ||
    safeValue === "next_round" ||
    safeValue === "end"
  ) {
    return safeValue;
  }
  return "next_question";
};

const getMaxQuestions = () => {
  const parsed = Number(process.env.INTERVIEW_MAX_QUESTIONS);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_MAX_QUESTIONS;
};

const getSessionContext = (session) => {
  const history = Array.isArray(session?.history) ? session.history : [];
  const roundsPlan = Array.isArray(session?.roundsPlan) ? session.roundsPlan : [];
  const roundsDetails = Array.isArray(session?.roundsDetails) ? session.roundsDetails : [];
  const rawRoundIndex = Number(session?.currentRoundIndex);
  const currentRoundIndex = Number.isFinite(rawRoundIndex)
    ? Math.max(0, Math.round(rawRoundIndex))
    : 0;
  const rawTotalRounds = Number(session?.totalRounds);
  const totalRounds = Number.isFinite(rawTotalRounds)
    ? Math.max(0, Math.round(rawTotalRounds))
    : 0;
  return {
    role: toSafeString(session?.role, "Software Engineer"),
    currentRound: toSafeString(session?.currentRound, DEFAULT_ROUND),
    currentRoundIndex,
    roundsPlan: roundsPlan.length > 0 ? roundsPlan : DEFAULT_ROUNDS_PLAN,
    roundsDetails,
    totalRounds:
      totalRounds || (roundsPlan.length > 0 ? roundsPlan.length : DEFAULT_ROUNDS_PLAN.length),
    difficultyLevel: toSafeString(session?.difficultyLevel, DEFAULT_DIFFICULTY),
    history,
  };
};

const normalizeQuestionText = (value) => {
  return toSafeString(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const getRelevantCompanyContext = (companyData) => {
  return {
    name: toSafeString(companyData?.name, "Unknown Company"),
    onlineQuestions: normalizeStringArray(
      companyData?.onlineQuestions || companyData?.online_questions
    ).slice(0, MAX_COMPANY_ITEMS),
    interviewQuestions: normalizeStringArray(
      companyData?.interviewQuestions ||
        companyData?.interview_questions ||
        companyData?.interviewQuestionsList
    ).slice(0, MAX_COMPANY_ITEMS),
    interviewProcess: normalizeStringArray(
      companyData?.interviewProcess || companyData?.interview_process
    ).slice(0, MAX_COMPANY_ITEMS),
    mustDoTopics: normalizeStringArray(
      companyData?.must_do_topics ||
        companyData?.Must_Do_Topics ||
        companyData?.mustDoTopics
    ).slice(0, MAX_COMPANY_ITEMS),
    prevCodingQuestions: normalizeStringArray(
      companyData?.prev_coding_ques || companyData?.prevCodingQuestions
    ).slice(0, MAX_COMPANY_ITEMS),
  };
};

const getSourceQuestionSet = (companyData) => {
  const relevant = getRelevantCompanyContext(companyData);
  return new Set(
    [
      ...relevant.onlineQuestions,
      ...relevant.interviewQuestions,
      ...relevant.prevCodingQuestions,
    ]
      .map(normalizeQuestionText)
      .filter(Boolean)
  );
};

const defaultRoundsDetailsFromPlan = (roundsPlan) => {
  return roundsPlan.map((round) => ({
    round,
    questionType:
      round === "online_assessment"
        ? "OA-style aptitude/coding"
        : round === "technical_interview"
        ? "DSA/CS fundamentals/project depth"
        : round === "hr_round"
        ? "behavioral/HR"
        : "mixed",
  }));
};

const getRecentHistoryForPrompt = (history, limit = 3) => {
  if (!Array.isArray(history)) {
    return [];
  }

  return history.slice(-limit).map((item) => ({
    question: toSafeString(item?.question),
    answer: toSafeString(item?.answer),
    score: toSafeNumber(item?.score, 0),
    feedback: toSafeString(item?.feedback),
    round: toSafeString(item?.round),
    difficulty: toSafeString(item?.difficulty),
  }));
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }

      if (item && typeof item === "object") {
        return toSafeString(item.question || item.content || item.title);
      }

      return "";
    })
    .filter(Boolean);
};

const parseInitialQuestionResponse = (text) => {
  const parsed = parseJSONResponse(text);
  const roundsPlan = normalizeStringArray(parsed?.roundsPlan || parsed?.rounds);
  const safeRoundsPlan = roundsPlan.length > 0 ? roundsPlan : DEFAULT_ROUNDS_PLAN;
  const safeRound = toSafeString(parsed?.round, safeRoundsPlan[0] || DEFAULT_ROUND);
  const roundIndex = Math.max(0, safeRoundsPlan.indexOf(safeRound));
  const roundsDetailsRaw = Array.isArray(parsed?.roundsDetails) ? parsed.roundsDetails : [];
  const roundsDetails = roundsDetailsRaw
    .map((item) => ({
      round: toSafeString(item?.round),
      questionType: toSafeString(item?.questionType),
    }))
    .filter((item) => item.round && item.questionType);

  return {
    question: toSafeString(parsed?.question),
    round: safeRound,
    difficulty: toSafeString(parsed?.difficulty, DEFAULT_DIFFICULTY),
    roundsPlan: safeRoundsPlan,
    roundsDetails:
      roundsDetails.length > 0 ? roundsDetails : defaultRoundsDetailsFromPlan(safeRoundsPlan),
    totalRounds: toSafeNumber(parsed?.totalRounds, safeRoundsPlan.length),
    currentRoundIndex: toSafeNumber(parsed?.currentRoundIndex, roundIndex),
  };
};

const parseInterviewPlanResponse = (text) => {
  const parsed = parseJSONResponse(text);
  const roundsPlan = normalizeStringArray(parsed?.roundsPlan || parsed?.rounds);
  const safeRoundsPlan = roundsPlan.length > 0 ? roundsPlan : DEFAULT_ROUNDS_PLAN;
  const roundsDetailsRaw = Array.isArray(parsed?.roundsDetails) ? parsed.roundsDetails : [];
  const roundsDetails = roundsDetailsRaw
    .map((item) => ({
      round: toSafeString(item?.round),
      questionType: toSafeString(item?.questionType),
    }))
    .filter((item) => item.round && item.questionType);

  return {
    roundsPlan: safeRoundsPlan,
    roundsDetails:
      roundsDetails.length > 0 ? roundsDetails : defaultRoundsDetailsFromPlan(safeRoundsPlan),
    totalRounds: toSafeNumber(parsed?.totalRounds, safeRoundsPlan.length),
    firstRound: toSafeString(parsed?.firstRound, safeRoundsPlan[0] || DEFAULT_ROUND),
    firstDifficulty: toSafeString(parsed?.firstDifficulty, DEFAULT_DIFFICULTY),
  };
};

export const generateInterviewPlan = async (companyData) => {
  const relevantCompany = getRelevantCompanyContext(companyData);

  const messages = [
    {
      role: "system",
      content: "Return strict JSON only. No markdown or extra text.",
    },
    {
      role: "user",
      content: `You are designing a company-specific interview structure for RV College placements.
Create adaptive rounds based on this company's real interview pattern.

Company name: ${relevantCompany.name}
onlineQuestions: ${JSON.stringify(relevantCompany.onlineQuestions)}
interviewQuestions: ${JSON.stringify(relevantCompany.interviewQuestions)}
interviewProcess: ${JSON.stringify(relevantCompany.interviewProcess)}
Must_Do_Topics: ${JSON.stringify(relevantCompany.mustDoTopics)}
interview_questions: ${JSON.stringify(relevantCompany.interviewQuestions)}
prev_coding_ques: ${JSON.stringify(relevantCompany.prevCodingQuestions)}

Return JSON:
{
  "roundsPlan": ["string"],
  "roundsDetails": [{"round":"string","questionType":"string"}],
  "totalRounds": number,
  "firstRound": "string",
  "firstDifficulty": "string"
}`,
    },
  ];

  const llmText = await callLLM(messages);
  return parseInterviewPlanResponse(llmText);
};

export const generateInitialQuestion = async (companyData) => {
  const relevantCompany = getRelevantCompanyContext(companyData);
  const sourceQuestionSet = getSourceQuestionSet(companyData);

  const messages = [
    {
      role: "system",
      content: "Return valid JSON only. Do not include markdown or extra text.",
    },
    {
      role: "user",
      content: `You are an interviewer for RV College placement prep.
Design company-specific interview rounds and ask first question.
Round count must be decided from company pattern and can vary (for example 2 to 5 rounds).
Questions must closely follow the company's actual pattern from provided fields.
Do NOT copy any source question verbatim. Always rephrase and twist wording while preserving intent and difficulty.

Company name: ${relevantCompany.name}
onlineQuestions: ${JSON.stringify(relevantCompany.onlineQuestions)}
interviewQuestions: ${JSON.stringify(relevantCompany.interviewQuestions)}
interviewProcess: ${JSON.stringify(relevantCompany.interviewProcess)}
Must_Do_Topics: ${JSON.stringify(relevantCompany.mustDoTopics)}
interview_questions: ${JSON.stringify(relevantCompany.interviewQuestions)}
prev_coding_ques: ${JSON.stringify(relevantCompany.prevCodingQuestions)}

Return JSON:
{
  "roundsPlan": ["string"],
  "totalRounds": number,
  "currentRoundIndex": number,
  "question": "string",
  "round": "string",
  "difficulty": "string"
}`,
    },
  ];

  const llmText = await callLLM(messages);
  const parsed = parseInitialQuestionResponse(llmText);
  const normalizedQuestion = normalizeQuestionText(parsed.question);

  if (sourceQuestionSet.has(normalizedQuestion) && parsed.question) {
    const rewriteMessages = [
      {
        role: "system",
        content: "Return strict JSON only. No markdown or extra text.",
      },
      {
        role: "user",
        content: `Rewrite this interview question so it is NOT verbatim from source data.
Keep intent, difficulty and round consistent.

Round: ${parsed.round}
Difficulty: ${parsed.difficulty}
Original question: ${parsed.question}

Return JSON:
{
  "question": "string"
}`,
      },
    ];

    const rewriteText = await callLLM(rewriteMessages);
    const rewritten = parseJSONResponse(rewriteText);
    parsed.question = toSafeString(rewritten?.question, parsed.question);
  }

  if (!parsed.question) {
    throw new Error("LLM did not return a valid initial interview question.");
  }

  return parsed;
};

const buildFallbackQuestion = ({ role, currentRound, difficultyLevel }) => {
  return `For the ${role} role, explain a real-world project decision relevant to the ${currentRound} round at ${difficultyLevel} difficulty.`;
};

const applyDifficultyChange = (currentDifficulty, action) => {
  const normalizedCurrent = toSafeString(currentDifficulty, DEFAULT_DIFFICULTY).toLowerCase();
  const currentIndex = DIFFICULTY_LEVELS.indexOf(normalizedCurrent);
  const safeIndex = currentIndex === -1 ? 1 : currentIndex;

  if (action === "increase") {
    return DIFFICULTY_LEVELS[Math.min(safeIndex + 1, DIFFICULTY_LEVELS.length - 1)];
  }

  if (action === "decrease") {
    return DIFFICULTY_LEVELS[Math.max(safeIndex - 1, 0)];
  }

  return DIFFICULTY_LEVELS[safeIndex];
};

const getSafeRoundIndex = (index, roundsPlan) => {
  const parsed = Number(index);
  const max = Math.max(0, roundsPlan.length - 1);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const rounded = Math.round(parsed);
  return Math.min(Math.max(rounded, 0), max);
};

const parseEvaluateAndDecideResponse = (text, context) => {
  const parsed = parseJSONResponse(text);
  const difficultyAction = normalizeDifficultyAction(parsed?.difficulty);
  const nextRound = toSafeString(parsed?.nextRound, context.currentRound);
  const roundIdxFromPlan = context.roundsPlan.indexOf(nextRound);
  return {
    score: toSafeNumber(parsed?.score, 0),
    feedback: toSafeString(parsed?.feedback, "No feedback generated."),
    nextAction: normalizeNextAction(parsed?.nextAction),
    nextQuestion: toSafeString(parsed?.nextQuestion, ""),
    nextRound,
    nextRoundIndex:
      toSafeNumber(parsed?.nextRoundIndex, roundIdxFromPlan >= 0 ? roundIdxFromPlan : context.currentRoundIndex),
    difficulty: difficultyAction,
  };
};

const resolveNextRoundState = (context, evaluation) => {
  const roundsPlan = Array.isArray(context.roundsPlan) && context.roundsPlan.length > 0
    ? context.roundsPlan
    : DEFAULT_ROUNDS_PLAN;
  const currentIndex = getSafeRoundIndex(context.currentRoundIndex, roundsPlan);
  const isLastRound = currentIndex >= roundsPlan.length - 1;
  const requestedAction = normalizeNextAction(evaluation.nextAction);
  let nextRoundIndex = currentIndex;

  // Enforce strict order: same round or exactly next round only.
  if (requestedAction === "next_round") {
    const explicitIdx = roundsPlan.indexOf(evaluation.nextRound);
    if (explicitIdx === currentIndex + 1) {
      nextRoundIndex = explicitIdx;
    } else {
      nextRoundIndex = Math.min(currentIndex + 1, roundsPlan.length - 1);
    }
  }

  // If model tries to end before final round, force sequential progression.
  if (requestedAction === "end" && !isLastRound) {
    nextRoundIndex = Math.min(currentIndex + 1, roundsPlan.length - 1);
  }

  const nextRound = roundsPlan[nextRoundIndex] || evaluation.nextRound || context.currentRound;
  const isRoundTransition =
    nextRoundIndex !== currentIndex || requestedAction === "next_round";

  return {
    nextRound,
    nextRoundIndex,
    roundsPlan,
    isRoundTransition,
    isLastRound,
    requestedAction,
  };
};

const ensureQuestionNotVerbatim = async ({
  question,
  companyData,
  round,
  difficulty,
}) => {
  const safeQuestion = toSafeString(question);
  if (!safeQuestion) return "";

  const sourceQuestionSet = getSourceQuestionSet(companyData);
  const normalized = normalizeQuestionText(safeQuestion);
  if (!sourceQuestionSet.has(normalized)) {
    return safeQuestion;
  }

  const rewriteMessages = [
    {
      role: "system",
      content: "Return strict JSON only. No markdown or extra text.",
    },
    {
      role: "user",
      content: `Rephrase and twist this question so it is not verbatim.
Keep same round intent and difficulty.
Round: ${toSafeString(round, DEFAULT_ROUND)}
Difficulty: ${toSafeString(difficulty, DEFAULT_DIFFICULTY)}
Question: ${safeQuestion}

Return JSON:
{
  "question": "string"
}`,
    },
  ];

  const rewriteText = await callLLM(rewriteMessages);
  const rewritten = parseJSONResponse(rewriteText);
  return toSafeString(rewritten?.question, safeQuestion);
};

export const evaluateAndDecide = async (session, userAnswer) => {
  if (!session) {
    throw new Error("evaluateAndDecide requires a valid session object.");
  }

  const sanitizedAnswer = toSafeString(userAnswer);
  if (!sanitizedAnswer) {
    throw new Error("evaluateAndDecide requires a non-empty userAnswer.");
  }

  const context = getSessionContext(session);
  const fullHistory = Array.isArray(session?.history) ? session.history : [];
  const recentHistory = getRecentHistoryForPrompt(fullHistory, 3);
  const currentQuestion =
    toSafeString(session?.currentQuestion) ||
    toSafeString(fullHistory[fullHistory.length - 1]?.question) ||
    "No previous question available.";
  const relevantCompany = getRelevantCompanyContext(session?.companyData || {});

  const messages = [
    {
      role: "system",
      content: "You are an adaptive interviewer. Return strict JSON only. No markdown. No extra text.",
    },
    {
      role: "user",
      content: `You are an adaptive interviewer.

Evaluate answer and decide next step.
Stay aligned with the company's interview style and sequence.

Current question: ${currentQuestion}
User answer: ${sanitizedAnswer}
Recent history (last 3): ${JSON.stringify(recentHistory)}
Rounds plan: ${JSON.stringify(context.roundsPlan)}
Rounds details: ${JSON.stringify(context.roundsDetails)}
Current round index: ${context.currentRoundIndex}
Company context: ${JSON.stringify(relevantCompany)}

Return JSON:
{
  "score": number,
  "feedback": "string",
  "nextAction": "follow_up" | "next_question" | "next_round" | "end",
  "nextQuestion": "string",
  "nextRound": "string",
  "nextRoundIndex": number,
  "difficulty": "increase" | "decrease" | "same"
}`,
    },
  ];

  const llmText = await callLLM(messages);
  const decision = parseEvaluateAndDecideResponse(llmText, context);

  return {
    ...decision,
    currentQuestion,
  };
};

export const generateFinalReport = async (session) => {
  if (!session) {
    throw new Error("generateFinalReport requires a valid session object.");
  }

  const fullHistory = Array.isArray(session?.history) ? session.history : [];
  if (fullHistory.length === 0) {
    return {
      overallScore: 0,
      strengths: [],
      weaknesses: [],
      improvementPlan: [],
    };
  }

  const messages = [
    {
      role: "system",
      content:
        "You are an interview coach. Return strict JSON only. No markdown. No extra text.",
    },
    {
      role: "user",
      content: `Generate detailed interview report:

* overall score
* strengths
* weaknesses
* improvement plan

Full history: ${JSON.stringify(fullHistory)}

Return JSON:
{
  "overallScore": number,
  "strengths": ["string"],
  "weaknesses": ["string"],
  "improvementPlan": ["string"]
}`,
    },
  ];

  const llmText = await callLLM(messages);
  const parsed = parseJSONResponse(llmText);

  const strengths = normalizeStringArray(parsed?.strengths);
  const weaknesses = normalizeStringArray(parsed?.weaknesses);
  const improvementPlan = normalizeStringArray(parsed?.improvementPlan);

  return {
    overallScore: toSafeNumber(parsed?.overallScore, 0),
    strengths,
    weaknesses,
    improvementPlan,
  };
};

export const runInterviewStep = async (session, userAnswer = null) => {
  if (!session) {
    throw new Error("runInterviewStep requires a valid session object.");
  }

  if (typeof userAnswer !== "string" && userAnswer !== null) {
    throw new Error("userAnswer must be a string or null.");
  }

  if (!Array.isArray(session.history)) {
    session.history = [];
  }

  const context = getSessionContext(session);
  const sanitizedAnswer = toSafeString(userAnswer);
  const isFirstStep = session.history.length === 0 && !toSafeString(session.currentQuestion);

  if (isFirstStep) {
    const initial = await generateInitialQuestion(session?.companyData || {});
    session.currentRound = initial.round;
    session.roundsPlan = initial.roundsPlan;
    session.roundsDetails = initial.roundsDetails;
    session.totalRounds = initial.totalRounds || initial.roundsPlan.length;
    session.currentRoundIndex = initial.currentRoundIndex;
    session.difficultyLevel = initial.difficulty;
    session.currentQuestion = initial.question;
    session.status = "in_progress";

    return {
      question: initial.question,
      feedback: null,
      score: null,
      status: "in_progress",
    };
  }

  if (!sanitizedAnswer) {
    throw new Error("userAnswer is required after the first interview step.");
  }

  const evaluation = await evaluateAndDecide(session, sanitizedAnswer);
  const roundState = resolveNextRoundState(context, evaluation);
  const nextDifficultyLevel = applyDifficultyChange(
    context.difficultyLevel,
    evaluation.difficulty
  );

  session.history.push({
    question: evaluation.currentQuestion,
    answer: sanitizedAnswer,
    score: evaluation.score,
    feedback: evaluation.feedback,
    round: context.currentRound,
    difficulty: context.difficultyLevel,
  });

  const reachedLimit = session.history.length >= getMaxQuestions();
  const shouldEndByAction =
    roundState.requestedAction === "end" && roundState.isLastRound;
  const shouldEndByLimit = reachedLimit && roundState.isLastRound;
  const shouldEndInterview = shouldEndByAction || shouldEndByLimit;

  if (shouldEndInterview) {
    const finalReport = await generateFinalReport(session);

    session.status = "completed";
    session.currentRound = roundState.nextRound;
    session.currentRoundIndex = roundState.nextRoundIndex;
    session.roundsPlan = roundState.roundsPlan;
    session.totalRounds = roundState.roundsPlan.length;
    session.difficultyLevel = nextDifficultyLevel;
    session.currentQuestion = null;

    return {
      question: null,
      feedback: evaluation.feedback,
      score: evaluation.score,
      status: "completed",
      report: finalReport,
    };
  }

  const candidateNextQuestion =
    evaluation.nextQuestion ||
    buildFallbackQuestion({
      role: context.role,
      currentRound: roundState.nextRound,
      difficultyLevel: nextDifficultyLevel,
    });
  const nextQuestion = await ensureQuestionNotVerbatim({
    question: candidateNextQuestion,
    companyData: session?.companyData || {},
    round: roundState.nextRound,
    difficulty: nextDifficultyLevel,
  });

  session.status = "in_progress";
  session.currentRound = roundState.nextRound;
  session.currentRoundIndex = roundState.nextRoundIndex;
  session.roundsPlan = roundState.roundsPlan;
  if (!Array.isArray(session.roundsDetails) || session.roundsDetails.length === 0) {
    session.roundsDetails = defaultRoundsDetailsFromPlan(roundState.roundsPlan);
  }
  session.totalRounds = roundState.roundsPlan.length;
  session.difficultyLevel = nextDifficultyLevel;
  session.currentQuestion = nextQuestion;

  const transitionMessage = roundState.isRoundTransition
    ? `Round "${context.currentRound}" is completed. Starting next round: "${roundState.nextRound}".`
    : null;

  return {
    question: nextQuestion,
    feedback: evaluation.feedback,
    score: evaluation.score,
    status: "in_progress",
    roundTransition: roundState.isRoundTransition
      ? {
          fromRound: context.currentRound,
          toRound: roundState.nextRound,
          message: transitionMessage,
        }
      : null,
  };
};

export default runInterviewStep;

