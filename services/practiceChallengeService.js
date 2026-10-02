/**
 * Daily / weekly DSA practice challenges + platform practice leaderboard.
 */
import PracticeChallenge from "../models/PracticeChallenge.js";
import PracticeChallengeAttempt from "../models/PracticeChallengeAttempt.js";
import UserPracticeStats from "../models/UserPracticeStats.js";
import InterviewQuestion from "../models/InterviewQuestion.js";
import {
  executeCode,
  normalizeExecutionLanguage,
} from "./codeExecution/executeCode.js";
import { deleteKey, getJSON, setJSON } from "../src/utils/redisHelpers.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAILY_PROBLEM_COUNT = 1;
const WEEKLY_PROBLEM_COUNT = 3;
const BOARD_TOP_N = 50;
const BOARD_CACHE_TTL_SEC = 60;
const PREVIEW_COOLDOWN_MS = 4 * 1000;

const previewCooldown = new Map();

function toSafeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function appError(message, code, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function actorFromUser(user = {}) {
  const userId = toSafeString(user.userId);
  if (!userId) throw appError("Unauthorized", "UNAUTHORIZED", 401);
  return {
    userId,
    name: toSafeString(user.name) || toSafeString(user.displayName) || "Student",
    email: toSafeString(user.email).toLowerCase(),
  };
}

function istParts(date = new Date()) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    // Mon=0 .. Sun=6 in ISO-ish for week calc from UTC after shift
    dow: (shifted.getUTCDay() + 6) % 7,
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** IST calendar day key YYYY-MM-DD */
export function istDayKey(date = new Date()) {
  const p = istParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Previous IST day key */
function prevIstDayKey(dayKey) {
  const [y, m, d] = String(dayKey).split("-").map(Number);
  const utcApprox = Date.UTC(y, m - 1, d, 12, 0, 0) - IST_OFFSET_MS;
  return istDayKey(new Date(utcApprox - 24 * 60 * 60 * 1000));
}

/**
 * ISO week key in IST: YYYY-Www (week starts Monday IST).
 */
export function istWeekKey(date = new Date()) {
  const p = istParts(date);
  // Thursday of this week determines ISO week year
  const dayUtc = Date.UTC(p.year, p.month - 1, p.day) - p.dow * 24 * 60 * 60 * 1000;
  const thursday = new Date(dayUtc + 3 * 24 * 60 * 60 * 1000);
  const weekYear = thursday.getUTCFullYear();
  const jan4 = Date.UTC(weekYear, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4Dow * 24 * 60 * 60 * 1000;
  const week = Math.floor((dayUtc - week1Monday) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${weekYear}-W${pad2(week)}`;
}

function istDayWindow(dayKey) {
  const [y, m, d] = String(dayKey).split("-").map(Number);
  const opensAt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - IST_OFFSET_MS);
  const closesAt = new Date(opensAt.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { opensAt, closesAt };
}

function istWeekWindow(weekKey) {
  const m = String(weekKey).match(/^(\d{4})-W(\d{2})$/);
  if (!m) {
    const dayKey = istDayKey();
    return istDayWindow(dayKey);
  }
  const weekYear = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = Date.UTC(weekYear, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1MondayUtcDate = jan4 - jan4Dow * 24 * 60 * 60 * 1000;
  // week1MondayUtcDate is midnight UTC of the Monday in "shifted" calendar space —
  // convert to real UTC by treating that as IST midnight.
  const mondayIstMidnightAsUtcParts = new Date(week1MondayUtcDate + (week - 1) * 7 * 24 * 60 * 60 * 1000);
  const y = mondayIstMidnightAsUtcParts.getUTCFullYear();
  const mo = mondayIstMidnightAsUtcParts.getUTCMonth() + 1;
  const d = mondayIstMidnightAsUtcParts.getUTCDate();
  const opensAt = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - IST_OFFSET_MS);
  const closesAt = new Date(opensAt.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
  return { opensAt, closesAt };
}

function boardCacheKey(period, periodKey) {
  return `rv:practice-board:${period}:${periodKey || "all"}:v1`;
}

export async function invalidatePracticeBoardCache() {
  const day = istDayKey();
  const week = istWeekKey();
  await Promise.all([
    deleteKey(boardCacheKey("daily", day)),
    deleteKey(boardCacheKey("weekly", week)),
    deleteKey(boardCacheKey("all", "all")),
  ]);
}

async function recentlyUsedQuestionIds(limit = 40) {
  const rows = await PracticeChallenge.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("problems.questionId")
    .lean();
  const ids = new Set();
  for (const row of rows) {
    for (const p of row.problems || []) {
      if (p?.questionId) ids.add(String(p.questionId));
    }
  }
  return ids;
}

async function pickBankProblems(count) {
  const used = await recentlyUsedQuestionIds(60);
  const filter = {
    evaluationStrategy: "code_execution",
    "testCases.0": { $exists: true },
  };
  let candidates = await InterviewQuestion.find(filter)
    .select("questionId title difficulty topics testCases dsaMetadata")
    .limit(200)
    .lean();

  candidates = candidates.filter((q) => {
    if (used.has(String(q.questionId))) return false;
    const cases = Array.isArray(q.testCases) ? q.testCases : [];
    return cases.length > 0;
  });

  if (candidates.length < count) {
    candidates = await InterviewQuestion.find(filter)
      .select("questionId title difficulty topics testCases dsaMetadata")
      .limit(200)
      .lean();
    candidates = candidates.filter((q) => (q.testCases || []).length > 0);
  }

  // Shuffle lightly
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const picked = candidates.slice(0, count);
  if (picked.length < count) {
    throw appError(
      "Not enough DSA coding questions in the bank to build a challenge",
      "BANK_EMPTY",
      503
    );
  }

  return picked.map((q) => ({
    questionId: String(q.questionId),
    title: String(q.title || "Coding problem").slice(0, 200),
    difficulty: ["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium",
    points: q.difficulty === "hard" ? 150 : q.difficulty === "easy" ? 80 : 100,
    topics: Array.isArray(q.topics) ? q.topics.slice(0, 8) : [],
  }));
}

async function ensureChallenge(kind) {
  const periodKey = kind === "weekly" ? istWeekKey() : istDayKey();
  let doc = await PracticeChallenge.findOne({ kind, periodKey });
  if (doc) {
    const now = Date.now();
    if (doc.status !== "closed" && now > new Date(doc.closesAt).getTime()) {
      doc.status = "closed";
      await doc.save();
    } else if (doc.status === "scheduled" && now >= new Date(doc.opensAt).getTime()) {
      doc.status = "active";
      await doc.save();
    }
    return doc;
  }

  const count = kind === "weekly" ? WEEKLY_PROBLEM_COUNT : DAILY_PROBLEM_COUNT;
  const problems = await pickBankProblems(count);
  const window = kind === "weekly" ? istWeekWindow(periodKey) : istDayWindow(periodKey);

  try {
    doc = await PracticeChallenge.create({
      kind,
      periodKey,
      opensAt: window.opensAt,
      closesAt: window.closesAt,
      problems,
      status: "active",
    });
  } catch (err) {
    if (err?.code === 11000) {
      doc = await PracticeChallenge.findOne({ kind, periodKey });
      if (doc) return doc;
    }
    throw err;
  }
  return doc;
}

function publicProblem(p, attempt = null, questionDoc = null) {
  const langs =
    questionDoc?.dsaMetadata?.supportedLanguages?.length > 0
      ? questionDoc.dsaMetadata.supportedLanguages
      : ["python", "cpp", "java"];
  const starter = questionDoc?.dsaMetadata?.starterCode || null;
  return {
    questionId: p.questionId,
    title: p.title,
    difficulty: p.difficulty,
    points: p.points,
    topics: p.topics || [],
    question: questionDoc?.question || "",
    functionSignature: questionDoc?.dsaMetadata?.functionSignature || "",
    supportedLanguages: langs,
    starterCode: starter,
    myBestScore: attempt?.score ?? null,
    mySubmittedAt: attempt?.submittedAt || null,
    myLanguage: attempt?.language || null,
  };
}

async function loadQuestionDocs(questionIds) {
  const ids = [...new Set(questionIds.map(String))];
  const docs = await InterviewQuestion.find({ questionId: { $in: ids } }).lean();
  const map = new Map();
  for (const d of docs) map.set(String(d.questionId), d);
  return map;
}

async function enrichChallengeForUser(doc, userId) {
  const qids = (doc.problems || []).map((p) => p.questionId);
  const [qmap, attempts] = await Promise.all([
    loadQuestionDocs(qids),
    userId
      ? PracticeChallengeAttempt.find({
          challengeId: doc._id,
          userId,
        }).lean()
      : Promise.resolve([]),
  ]);
  const attemptByQ = new Map();
  for (const a of attempts) attemptByQ.set(String(a.questionId), a);

  const problems = (doc.problems || []).map((p) =>
    publicProblem(p, attemptByQ.get(String(p.questionId)), qmap.get(String(p.questionId)))
  );
  const solvedCount = problems.filter((p) => p.myBestScore != null && p.myBestScore > 0).length;
  const myPoints = problems.reduce((s, p) => s + (Number(p.myBestScore) || 0), 0);

  return {
    id: String(doc._id),
    kind: doc.kind,
    periodKey: doc.periodKey,
    opensAt: doc.opensAt,
    closesAt: doc.closesAt,
    status: doc.status,
    problems,
    problemCount: problems.length,
    mySolvedCount: solvedCount,
    myPoints,
  };
}

export async function getTodayChallenge(input = {}) {
  const actor = actorFromUser(input.user);
  const doc = await ensureChallenge("daily");
  return enrichChallengeForUser(doc, actor.userId);
}

export async function getWeekChallenge(input = {}) {
  const actor = actorFromUser(input.user);
  const doc = await ensureChallenge("weekly");
  return enrichChallengeForUser(doc, actor.userId);
}

export async function getChallengeById(input = {}) {
  const actor = actorFromUser(input.user);
  const id = toSafeString(input.challengeId);
  if (!id) throw appError("challengeId is required", "INVALID_ID");
  const doc = await PracticeChallenge.findById(id);
  if (!doc) throw appError("Challenge not found", "NOT_FOUND", 404);
  return enrichChallengeForUser(doc, actor.userId);
}

export async function ensureChallengesNow() {
  const [daily, weekly] = await Promise.all([
    ensureChallenge("daily"),
    ensureChallenge("weekly"),
  ]);
  return {
    daily: { id: String(daily._id), periodKey: daily.periodKey, problems: daily.problems.length },
    weekly: { id: String(weekly._id), periodKey: weekly.periodKey, problems: weekly.problems.length },
  };
}

function visibleCases(testCases) {
  return (Array.isArray(testCases) ? testCases : []).filter((t) => t?.isHidden !== true);
}

function allCases(testCases) {
  return Array.isArray(testCases) ? testCases : [];
}

async function loadChallengeProblem(challengeId, questionId) {
  const doc = await PracticeChallenge.findById(challengeId);
  if (!doc) throw appError("Challenge not found", "NOT_FOUND", 404);
  const now = Date.now();
  if (now < new Date(doc.opensAt).getTime()) {
    throw appError("This challenge is not open yet", "NOT_OPEN");
  }
  if (now > new Date(doc.closesAt).getTime() || doc.status === "closed") {
    throw appError("This challenge has closed", "CLOSED");
  }
  const problem = (doc.problems || []).find((p) => String(p.questionId) === String(questionId));
  if (!problem) throw appError("Problem not part of this challenge", "INVALID_PROBLEM");
  const question = await InterviewQuestion.findOne({ questionId: String(questionId) }).lean();
  if (!question) throw appError("Question missing from bank", "QUESTION_MISSING", 404);
  if (question.evaluationStrategy !== "code_execution") {
    throw appError("Only coding problems are supported", "INVALID_STRATEGY");
  }
  return { challenge: doc, problem, question };
}

function scoreFromExecution(execution) {
  const rate = Number(execution?.weightedPassRate);
  if (Number.isFinite(rate) && rate >= 0) {
    return Math.max(0, Math.min(100, Math.round(rate * 100)));
  }
  const results = Array.isArray(execution?.results) ? execution.results : [];
  if (results.length === 0) return 0;
  const passed = results.filter((r) => r?.passed === true).length;
  return Math.round((passed / results.length) * 100);
}

export async function runChallengePreview(input = {}) {
  const actor = actorFromUser(input.user);
  const challengeId = toSafeString(input.challengeId);
  const questionId = toSafeString(input.questionId);
  const code = toSafeString(input.code);
  const language = normalizeExecutionLanguage(input.language || "python");

  if (!code) throw appError("Code is required", "CODE_REQUIRED");

  const cooldownKey = `${actor.userId}:${challengeId}:${questionId}`;
  const last = Number(previewCooldown.get(cooldownKey) || 0);
  if (last && Date.now() - last < PREVIEW_COOLDOWN_MS) {
    throw appError("Please wait before running another preview", "COOLDOWN", 429);
  }
  previewCooldown.set(cooldownKey, Date.now());

  const { question } = await loadChallengeProblem(challengeId, questionId);
  const cases = visibleCases(question.testCases);
  if (cases.length === 0) {
    throw appError("No visible test cases for preview", "NO_TESTS");
  }

  const execution = await executeCode({
    language,
    code,
    testCases: cases,
    functionSignature: question.dsaMetadata?.functionSignature || "",
  });

  return {
    success: true,
    mode: "preview",
    language,
    score: scoreFromExecution(execution),
    execution: {
      status: execution.status,
      passedCount: execution.passedCount,
      failedCount: execution.failedCount,
      visiblePassedCount: execution.visiblePassedCount,
      results: (execution.results || []).map((r) => ({
        passed: r.passed,
        isHidden: false,
        input: r.input,
        expectedOutput: r.expectedOutput,
        actualOutput: r.actualOutput,
        error: r.error,
      })),
      error: execution.error || "",
      executionTime: execution.executionTime,
    },
  };
}

async function updateUserStatsAfterSubmit({
  actor,
  challenge,
  questionId,
  newScore,
  previousScore,
}) {
  const dayKey = istDayKey();
  const weekKey = istWeekKey();
  let stats = await UserPracticeStats.findOne({ userId: actor.userId });
  if (!stats) {
    stats = new UserPracticeStats({
      userId: actor.userId,
      displayName: actor.name,
      email: actor.email,
    });
  } else {
    stats.displayName = actor.name || stats.displayName;
    stats.email = actor.email || stats.email;
  }

  if (stats.dailyPeriodKey !== dayKey) {
    stats.dailyPeriodKey = dayKey;
    stats.dailyPoints = 0;
  }
  if (stats.weeklyPeriodKey !== weekKey) {
    stats.weeklyPeriodKey = weekKey;
    stats.weeklyPoints = 0;
  }

  const delta = Math.max(0, Number(newScore) - Number(previousScore || 0));
  if (delta > 0) {
    stats.pointsTotal = (stats.pointsTotal || 0) + delta;
    if (challenge.kind === "daily") {
      stats.dailyPoints = (stats.dailyPoints || 0) + delta;
      stats.weeklyPoints = (stats.weeklyPoints || 0) + delta;
    } else if (challenge.kind === "weekly") {
      stats.weeklyPoints = (stats.weeklyPoints || 0) + delta;
    }
  }

  if (Number(newScore) > 0 && Number(previousScore || 0) <= 0) {
    stats.solvesTotal = (stats.solvesTotal || 0) + 1;
  }

  // Streak on daily challenge with score > 0
  if (challenge.kind === "daily" && Number(newScore) > 0) {
    const last = stats.lastSolveDayKey || "";
    if (last !== dayKey) {
      if (last && last === prevIstDayKey(dayKey)) {
        stats.currentStreak = (stats.currentStreak || 0) + 1;
      } else {
        stats.currentStreak = 1;
      }
      stats.lastSolveDayKey = dayKey;
      stats.longestStreak = Math.max(stats.longestStreak || 0, stats.currentStreak || 0);
    }
  }

  await stats.save();
  return stats;
}

export async function submitChallengeSolution(input = {}) {
  const actor = actorFromUser(input.user);
  const challengeId = toSafeString(input.challengeId);
  const questionId = toSafeString(input.questionId);
  const code = toSafeString(input.code);
  const language = normalizeExecutionLanguage(input.language || "python");
  if (!code) throw appError("Code is required", "CODE_REQUIRED");

  const { challenge, question } = await loadChallengeProblem(challengeId, questionId);
  const cases = allCases(question.testCases);
  if (cases.length === 0) throw appError("No test cases for this problem", "NO_TESTS");

  const started = Date.now();
  const execution = await executeCode({
    language,
    code,
    testCases: cases,
    functionSignature: question.dsaMetadata?.functionSignature || "",
  });
  const timeMs = Date.now() - started;
  const score = scoreFromExecution(execution);

  const existing = await PracticeChallengeAttempt.findOne({
    challengeId: challenge._id,
    questionId,
    userId: actor.userId,
  });
  const previousScore = existing?.score || 0;

  // Keep best score (and its code)
  let attempt;
  if (!existing || score >= previousScore) {
    attempt = await PracticeChallengeAttempt.findOneAndUpdate(
      { challengeId: challenge._id, questionId, userId: actor.userId },
      {
        $set: {
          language,
          code,
          score,
          weightedPassRate: Number(execution.weightedPassRate) || 0,
          passedVisible: Number(execution.visiblePassedCount) || 0,
          passedHidden: Number(execution.hiddenPassedCount) || 0,
          totalVisible: (execution.results || []).filter((r) => r?.isHidden !== true).length,
          totalHidden: (execution.results || []).filter((r) => r?.isHidden === true).length,
          status: "submitted",
          timeMs,
          executionStatus: String(execution.status || ""),
          submittedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
  } else {
    attempt = existing;
  }

  await updateUserStatsAfterSubmit({
    actor,
    challenge,
    questionId,
    newScore: Math.max(score, previousScore),
    previousScore,
  });
  await invalidatePracticeBoardCache();

  const publicResults = (execution.results || []).map((r) => {
    if (r?.isHidden) {
      return { passed: r.passed, isHidden: true };
    }
    return {
      passed: r.passed,
      isHidden: false,
      input: r.input,
      expectedOutput: r.expectedOutput,
      actualOutput: r.actualOutput,
      error: r.error,
    };
  });

  return {
    success: true,
    mode: "submit",
    language,
    score: attempt.score,
    bestScore: attempt.score,
    improved: score >= previousScore,
    execution: {
      status: execution.status,
      passedCount: execution.passedCount,
      failedCount: execution.failedCount,
      visiblePassedCount: execution.visiblePassedCount,
      hiddenPassedCount: execution.hiddenPassedCount,
      weightedPassRate: execution.weightedPassRate,
      results: publicResults,
      error: execution.error || "",
      executionTime: execution.executionTime,
    },
    challenge: await enrichChallengeForUser(challenge, actor.userId),
  };
}

async function periodPointsForBoard(period) {
  const dayKey = istDayKey();
  const weekKey = istWeekKey();
  if (period === "daily") {
    // Prefer attempts on today's daily challenge for accuracy
    const daily = await PracticeChallenge.findOne({ kind: "daily", periodKey: dayKey }).lean();
    if (!daily) return { periodKey: dayKey, rows: [] };
    const agg = await PracticeChallengeAttempt.aggregate([
      { $match: { challengeId: daily._id } },
      { $group: { _id: "$userId", points: { $sum: "$score" } } },
      { $sort: { points: -1 } },
      { $limit: BOARD_TOP_N },
    ]);
    return { periodKey: dayKey, rows: agg.map((r) => ({ userId: r._id, points: r.points })) };
  }
  if (period === "weekly") {
    const weekly = await PracticeChallenge.findOne({ kind: "weekly", periodKey: weekKey }).lean();
    const daily = await PracticeChallenge.findOne({ kind: "daily", periodKey: dayKey }).lean();
    // Sum attempts for this week's weekly challenge; also include today's daily for mid-week activity
    const challengeIds = [weekly?._id, daily?._id].filter(Boolean);
    // Better: all daily challenges this week + weekly set
    const weekWindow = istWeekWindow(weekKey);
    const challenges = await PracticeChallenge.find({
      $or: [
        { kind: "weekly", periodKey: weekKey },
        {
          kind: "daily",
          opensAt: { $gte: weekWindow.opensAt, $lte: weekWindow.closesAt },
        },
      ],
    })
      .select("_id")
      .lean();
    const ids = challenges.map((c) => c._id);
    if (ids.length === 0) return { periodKey: weekKey, rows: [] };
    const agg = await PracticeChallengeAttempt.aggregate([
      { $match: { challengeId: { $in: ids } } },
      { $group: { _id: "$userId", points: { $sum: "$score" } } },
      { $sort: { points: -1 } },
      { $limit: BOARD_TOP_N },
    ]);
    return { periodKey: weekKey, rows: agg.map((r) => ({ userId: r._id, points: r.points })) };
  }
  // all-time from stats
  const stats = await UserPracticeStats.find({})
    .sort({ pointsTotal: -1 })
    .limit(BOARD_TOP_N)
    .select("userId displayName email pointsTotal currentStreak solvesTotal")
    .lean();
  return {
    periodKey: "all",
    rows: stats.map((s) => ({
      userId: s.userId,
      points: s.pointsTotal || 0,
      displayName: s.displayName,
      email: s.email,
      currentStreak: s.currentStreak,
      solvesTotal: s.solvesTotal,
    })),
  };
}

async function attachDisplayNames(rows) {
  const missing = rows.filter((r) => !r.displayName).map((r) => r.userId);
  if (missing.length === 0) return rows;
  const stats = await UserPracticeStats.find({ userId: { $in: missing } })
    .select("userId displayName email currentStreak solvesTotal")
    .lean();
  const map = new Map(stats.map((s) => [s.userId, s]));
  return rows.map((r) => {
    const s = map.get(r.userId);
    return {
      ...r,
      displayName: r.displayName || s?.displayName || "Student",
      email: r.email || s?.email || "",
      currentStreak: r.currentStreak ?? s?.currentStreak ?? 0,
      solvesTotal: r.solvesTotal ?? s?.solvesTotal ?? 0,
    };
  });
}

export async function getPracticeLeaderboard(input = {}) {
  actorFromUser(input.user);
  const period = ["daily", "weekly", "all"].includes(input.period) ? input.period : "weekly";
  const { periodKey, rows: rawRows } = await periodPointsForBoard(period);
  const cacheKey = boardCacheKey(period, periodKey);
  const cached = await getJSON(cacheKey);
  if (cached?.entries) return cached;

  const named = await attachDisplayNames(rawRows);
  const entries = named.map((r, i) => ({
    rank: i + 1,
    userId: r.userId,
    displayName: r.displayName || "Student",
    points: r.points || 0,
    currentStreak: r.currentStreak || 0,
    solvesTotal: r.solvesTotal || 0,
  }));

  const payload = {
    success: true,
    period,
    periodKey,
    entries,
    updatedAt: new Date().toISOString(),
  };
  await setJSON(cacheKey, payload, BOARD_CACHE_TTL_SEC);
  return payload;
}

export async function getMyPracticeRank(input = {}) {
  const actor = actorFromUser(input.user);
  const period = ["daily", "weekly", "all"].includes(input.period) ? input.period : "weekly";
  const board = await getPracticeLeaderboard({ user: input.user, period });
  const mine = (board.entries || []).find((e) => e.userId === actor.userId);

  let points = mine?.points || 0;
  let rank = mine?.rank || null;

  if (!mine) {
    // compute points even if outside top N
    if (period === "all") {
      const stats = await UserPracticeStats.findOne({ userId: actor.userId }).lean();
      points = stats?.pointsTotal || 0;
      if (points > 0) {
        const better = await UserPracticeStats.countDocuments({ pointsTotal: { $gt: points } });
        rank = better + 1;
      }
    } else {
      const { rows } = await periodPointsForBoard(period);
      const row = rows.find((r) => r.userId === actor.userId);
      points = row?.points || 0;
      // Full count for rank
      // Re-aggregate without limit for rank — approximate via recount
      if (points > 0) {
        const full = await periodPointsForBoard(period); // already top N only
        const idx = full.rows.findIndex((r) => r.userId === actor.userId);
        rank = idx >= 0 ? idx + 1 : null;
      }
    }
  }

  const stats = await UserPracticeStats.findOne({ userId: actor.userId }).lean();
  const totalPlayers =
    period === "all"
      ? await UserPracticeStats.countDocuments({ pointsTotal: { $gt: 0 } })
      : Math.max(board.entries?.length || 0, rank || 0);

  let percentile = null;
  if (rank && totalPlayers > 0) {
    percentile = Math.max(0, Math.round((1 - (rank - 1) / totalPlayers) * 100));
  }

  return {
    success: true,
    period,
    periodKey: board.periodKey,
    me: {
      userId: actor.userId,
      displayName: stats?.displayName || actor.name,
      points,
      rank,
      percentile,
      currentStreak: stats?.currentStreak || 0,
      longestStreak: stats?.longestStreak || 0,
      solvesTotal: stats?.solvesTotal || 0,
    },
  };
}
