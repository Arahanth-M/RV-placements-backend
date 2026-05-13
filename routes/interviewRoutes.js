import express from "express";
import mongoose from "mongoose";
import CompanyStatic from "../models/CompanyStatic.js";
import InterviewQuestion from "../models/InterviewQuestion.js";
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
  interviewRunPreviewSchema,
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
  collectTopicsForCompletedCodingRound,
} from "../services/interviewSessionService.js";
import {
  generateInterviewPlanFromCustomRounds,
} from "../services/interviewEngine.js";
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
import { executeCode, normalizeExecutionLanguage } from "../services/codeExecution/executeCode.js";

const router = express.Router();
router.use(authJWT);
router.use(checkBetaAccess);
router.use(authorize(["student", "admin", "spc"]));

const getAuthenticatedUserId = (req) => String(req.user?.userId || "").trim();
const isSessionOwner = (session, userId) => String(session?.userId || "") === userId;

/** DSA rounds never show or plan more than three questions (legacy sessions may still store a higher count). */
const isDsaInterviewRoundType = (t) => String(t || "").trim().toUpperCase() === "DSA";

const toClientStatus = (state) =>
  state === INTERVIEW_STATES.INTERVIEW_COMPLETE ? "completed" : "in_progress";

const toClientInterviewStatus = (state) =>
  state === INTERVIEW_STATES.INTERVIEW_COMPLETE ? "COMPLETED" : "IN_PROGRESS";

const toRelevanceLabel = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric >= 0.62 ? "relevant" : "irrelevant";
};

/** Bank `complexity: { time, space }` → safe client payload or null. */
const extractQuestionComplexityForClient = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const time = raw.time != null ? String(raw.time).trim() : "";
  const space = raw.space != null ? String(raw.space).trim() : "";
  if (!time && !space) return null;
  return {
    ...(time ? { time } : {}),
    ...(space ? { space } : {}),
  };
};

const buildLastCodeExecutionSummary = (evaluationTrace) => {
  const ex = evaluationTrace?.execution;
  if (!ex || typeof ex !== "object") return null;
  const totalCount = Number(ex.totalCount);
  if (!Number.isFinite(totalCount) || totalCount < 0) return null;
  return {
    status: String(ex.status || ""),
    totalCount,
    passedCount: Number(ex.passedCount) || 0,
    failedCount: Number(ex.failedCount) || 0,
    visibleTotalCount: Number(ex.visibleTotalCount) || 0,
    visiblePassedCount: Number(ex.visiblePassedCount) || 0,
    hiddenTotalCount: Number(ex.hiddenTotalCount) || 0,
    hiddenPassedCount: Number(ex.hiddenPassedCount) || 0,
    userDebugOutput: typeof ex.userDebugOutput === "string" ? ex.userDebugOutput : "",
  };
};

const resolveSupportedCodingLanguages = (
  questionSlot,
  evaluationStrategyFallback = "",
  dsaMetadataFallback = null
) => {
  const fromSlot = questionSlot?.supportedCodingLanguages;
  const fromMeta = dsaMetadataFallback?.supportedLanguages;
  const rawSlot = Array.isArray(fromSlot) && fromSlot.length > 0 ? fromSlot : null;
  const rawMeta = Array.isArray(fromMeta) && fromMeta.length > 0 ? fromMeta : null;
  const raw = rawSlot || rawMeta;
  const isCodeExec = String(evaluationStrategyFallback || "").toLowerCase() === "code_execution";

  if (Array.isArray(raw) && raw.length > 0) {
    const s = new Set();
    for (const item of raw) {
      const v = normalizeExecutionLanguage(String(item || ""));
      if (v === "python" || v === "cpp" || v === "java") s.add(v);
    }
    let out = [...s];
    if (out.length === 0 && isCodeExec) {
      return ["python", "cpp", "java"];
    }
    if (isCodeExec) {
      if (!out.includes("python")) out.unshift("python");
      if (!out.includes("cpp")) out.push("cpp");
      if (!out.includes("java")) out.push("java");
    }
    return out.length > 0 ? out : ["python"];
  }
  if (isCodeExec) {
    return ["python", "cpp", "java"];
  }
  return ["python"];
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
const previewCooldownBySessionUser = new Map();
const PREVIEW_COOLDOWN_MS = 2000;
const PREVIEW_RUN_LIMIT_PER_QUESTION = 3;
const PREVIEW_QUESTION_LOOKUP_CANDIDATE_LIMIT = 2000;

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeQuestionForLookup = (value) =>
  toSafeString(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();

const buildPreviewLookupLogContext = ({
  route,
  sessionId,
  currentRoundIndex,
  currentQuestionIndex,
  roundType,
  slotQuestionId,
  slotQuestionText,
  rootQuestionText,
  resolvedQuestionId,
  resolvedQuestionText,
  strategy,
  visibleCount,
  totalTestCases,
  hasSqlMetadata,
}) => ({
  route,
  sessionId: toSafeString(sessionId),
  currentRoundIndex: Number(currentRoundIndex) || 0,
  currentQuestionIndex: Number(currentQuestionIndex) || 0,
  roundType: toSafeString(roundType),
  strategy: toSafeString(strategy),
  slotQuestionId: toSafeString(slotQuestionId),
  slotQuestionTextLen: toSafeString(slotQuestionText).length,
  rootQuestionTextLen: toSafeString(rootQuestionText).length,
  resolvedQuestionId: toSafeString(resolvedQuestionId),
  resolvedQuestionTextLen: toSafeString(resolvedQuestionText).length,
  totalTestCases: Number(totalTestCases) || 0,
  visibleCount: Number(visibleCount) || 0,
  hasSqlMetadata: hasSqlMetadata === true,
});

const buildLooseQuestionRegex = (questionText) => {
  const normalized = normalizeQuestionForLookup(questionText);
  if (!normalized) return null;
  const tokens = normalized.split(" ").filter(Boolean).slice(0, 8);
  if (tokens.length === 0) return null;
  const escaped = tokens.map((token) => escapeRegex(token));
  return escaped.join(".*");
};

const classifyRoundForLookup = (roundType) => {
  const safe = toSafeString(roundType).toLowerCase();
  if (!safe) return null;
  if (
    safe.includes("sql") ||
    safe.includes("database") ||
    safe.includes("dbms")
  ) {
    return "sql";
  }
  if (
    safe.includes("dsa") ||
    safe.includes("coding") ||
    safe.includes("algorithm") ||
    safe.includes("data structure")
  ) {
    return "dsa";
  }
  return null;
};

async function resolveInterviewQuestionDoc({
  questionId = "",
  questionText = "",
  roundType = "",
  includeFullDoc = false,
}) {
  const safeQuestionId = toSafeString(questionId);
  const safeQuestionText = toSafeString(questionText);
  const projection = includeFullDoc
    ? ""
    : "questionId url testCases sqlMetadata dsaMetadata topics subtopics companyTags complexity";
  const applyProjection = (query) => (projection ? query.select(projection) : query);

  if (safeQuestionId) {
    const byId = await applyProjection(InterviewQuestion.findOne({ questionId: safeQuestionId })).lean();
    if (byId) return byId;
  }

  if (safeQuestionText) {
    const byExact = await applyProjection(
      InterviewQuestion.findOne({ question: safeQuestionText })
    ).lean();
    if (byExact) return byExact;

    const byCaseInsensitiveExact = await applyProjection(
      InterviewQuestion.findOne({
        question: { $regex: `^${escapeRegex(safeQuestionText)}$`, $options: "i" },
      })
    ).lean();
    if (byCaseInsensitiveExact) return byCaseInsensitiveExact;

    const looseRegex = buildLooseQuestionRegex(safeQuestionText);
    if (looseRegex) {
      const family = classifyRoundForLookup(roundType);
      const familyFilter =
        family === "sql"
          ? { roundType: { $regex: "(sql|database|dbms)", $options: "i" } }
          : family === "dsa"
          ? { roundType: { $regex: "(dsa|coding|algorithm|data\\s*structure)", $options: "i" } }
          : {};
      const byLooseRegex = await applyProjection(
        InterviewQuestion.findOne({
          ...familyFilter,
          question: { $regex: looseRegex, $options: "i" },
        })
      ).lean();
      if (byLooseRegex) return byLooseRegex;
    }
  }

  const normalizedTarget = normalizeQuestionForLookup(safeQuestionText);
  if (!normalizedTarget) return null;

  const family = classifyRoundForLookup(roundType);
  const familyFilter =
    family === "sql"
      ? { roundType: { $regex: "(sql|database|dbms)", $options: "i" } }
      : family === "dsa"
      ? { roundType: { $regex: "(dsa|coding|algorithm|data\\s*structure)", $options: "i" } }
      : {};

  const candidateDocs = await InterviewQuestion.find(familyFilter)
    .select(
      includeFullDoc ? "" : "question url testCases sqlMetadata dsaMetadata topics subtopics companyTags complexity"
    )
    .limit(PREVIEW_QUESTION_LOOKUP_CANDIDATE_LIMIT)
    .lean();

  const fallbackMatch = candidateDocs.find(
    (doc) => normalizeQuestionForLookup(doc?.question) === normalizedTarget
  );
  if (fallbackMatch) {
    console.log("[previewQuestionLookup] matched by normalized text", {
      includeFullDoc,
      hasQuestionId: Boolean(safeQuestionId),
      roundType: toSafeString(roundType),
      matchedQuestion: toSafeString(fallbackMatch?.question).slice(0, 120),
      visibleCount: Array.isArray(fallbackMatch?.testCases)
        ? fallbackMatch.testCases.filter((t) => t?.isHidden !== true).length
        : 0,
    });
  }
  return fallbackMatch || null;
}

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

function resolveActiveQuestionContext(session) {
  const rounds = Array.isArray(session?.rounds) ? session.rounds : [];
  const currentRoundNumber = Number(session?.currentRound) || 1;
  const currentRoundIndex = Math.max(0, Math.min(rounds.length - 1, currentRoundNumber - 1));
  const currentQuestionIndex = Number(session?.currentQuestionIndex) || 0;
  const currentRoundDoc = rounds[currentRoundIndex];
  const questionSlot = currentRoundDoc?.questions?.[currentQuestionIndex] || null;
  return { rounds, currentRoundIndex, currentQuestionIndex, currentRoundDoc, questionSlot };
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
      customRounds = [],
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

    const existingSession = await getInProgressSession(
      userId,
      companyId,
      norm.type,
      mergePlacementByType ? "" : norm.cluster,
      placementYear,
      mergePlacementByType
    );
    if (existingSession?._id) {
      await Promise.all([
        discardInProgressSession(existingSession._id),
        invalidateInterviewDetail(existingSession._id),
        clearInterviewProcessing(existingSession._id),
      ]);
    }
    const session = await createSession(userId, companyId, {
      placementVisitType: norm.type,
      placementCluster: mergePlacementByType ? "" : norm.cluster,
      placementYear,
      mergePlacementByType,
    });

    let plan;
    try {
      plan = await generateInterviewPlanFromCustomRounds(customRounds);
    } catch (planError) {
      const message = planError?.message || "Invalid interview plan.";
      return res.status(400).json({ error: message });
    }
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
    const responsePayload = {
      question: roundStart.question,
      questionUrl: String(roundStart.questionUrl || "").trim(),
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

    await Promise.all([
      invalidateInterviewSummaries(userId),
      invalidateInterviewDetail(session._id),
    ]);

    return res.status(201).json({
      sessionId: session._id,
      ...responsePayload,
      resumed: false,
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
    const { sessionId, answer, language: languageRaw } = req.body;
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

    const wantLang = normalizeExecutionLanguage(languageRaw);
    const { questionSlot } = resolveActiveQuestionContext(session);
    const submitEvalStrategy = String(
      questionSlot?.evaluationStrategy ||
        (String(languageRaw || "").toLowerCase() === "sql" ? "rubric_llm" : "code_execution")
    ).trim();
    if (submitEvalStrategy === "code_execution") {
      const allowed = resolveSupportedCodingLanguages(
        questionSlot,
        submitEvalStrategy,
        null
      );
      if (!allowed.includes(wantLang)) {
        return res.status(400).json({
          error: `Language "${wantLang}" is not enabled for this question.`,
        });
      }
    }

    try {
      await markInterviewProcessing(sessionId);
      await invalidateSessionAndSummaryCaches(userId, sessionId);
      const job = await interviewQueue.add(EVALUATE_ANSWER, {
        sessionId,
        answer: answer.trim(),
        language: wantLang,
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

router.post("/run-preview", validateRequest(interviewRunPreviewSchema), async (req, res) => {
  try {
    const { sessionId, code, language } = req.body;
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!isSessionOwner(session, userId)) return res.status(403).json({ error: "Forbidden" });
    if (session.state === INTERVIEW_STATES.INTERVIEW_COMPLETE) {
      return res.status(400).json({ success: false, message: "Interview already completed." });
    }

    const cooldownKey = `${userId}:${sessionId}`;
    const now = Date.now();
    const lastRunAt = Number(previewCooldownBySessionUser.get(cooldownKey) || 0);
    if (lastRunAt && now - lastRunAt < PREVIEW_COOLDOWN_MS) {
      return res.status(429).json({
        success: false,
        message: "Please wait before running another preview.",
      });
    }

    const { currentRoundIndex, currentQuestionIndex, questionSlot } = resolveActiveQuestionContext(session);
    if (!questionSlot || typeof questionSlot.question !== "string" || !questionSlot.question.trim()) {
      return res.status(400).json({ success: false, message: "No active question available." });
    }

    const runCount = Number(questionSlot.previewRunCount) || 0;
    if (runCount >= PREVIEW_RUN_LIMIT_PER_QUESTION) {
      return res.status(429).json({
        success: false,
        message: "Preview run limit reached for this question.",
      });
    }

    const strategy = String(
      questionSlot.evaluationStrategy ||
        (String(language || "").toLowerCase() === "sql" ? "rubric_llm" : "code_execution")
    ).trim();
    const questionId = String(questionSlot.questionId || "").trim();
    const questionText = String(questionSlot.question || session?.currentQuestion || "").trim();
    const roundTypeForLookup =
      session?.rounds?.[currentRoundIndex]?.type ||
      session?.roundsDetails?.[currentRoundIndex]?.questionType ||
      "";
    const questionDoc = await resolveInterviewQuestionDoc({
      questionId,
      questionText,
      roundType: roundTypeForLookup,
      includeFullDoc: true,
    });
    if (!questionDoc) {
      console.warn(
        "[previewQuestionLookup] run-preview: no questionDoc",
        buildPreviewLookupLogContext({
          route: "run-preview",
          sessionId,
          currentRoundIndex,
          currentQuestionIndex,
          roundType: roundTypeForLookup,
          slotQuestionId: questionId,
          slotQuestionText: questionSlot?.question || "",
          rootQuestionText: session?.currentQuestion || "",
          strategy,
          visibleCount: 0,
          totalTestCases: 0,
          hasSqlMetadata: false,
        })
      );
      return res.status(400).json({
        success: false,
        message: "Preview is unavailable for this question.",
      });
    }

    if (strategy === "code_execution") {
      const wantLang = normalizeExecutionLanguage(language);
      const allowedLangs = resolveSupportedCodingLanguages(
        questionSlot,
        strategy,
        questionDoc?.dsaMetadata || null
      );
      if (!allowedLangs.includes(wantLang)) {
        return res.status(400).json({
          success: false,
          message: `Language "${wantLang}" is not enabled for this question.`,
        });
      }
    }

    if (!questionId && questionDoc?.questionId) {
      const slotQuestionIdPath = `rounds.${currentRoundIndex}.questions.${currentQuestionIndex}.questionId`;
      await mongoose.connection.collection("interviewsessions").updateOne(
        {
          _id: session._id,
          [slotQuestionIdPath]: { $exists: false },
        },
        {
          $set: { [slotQuestionIdPath]: String(questionDoc.questionId).trim() },
        }
      );
    }

    previewCooldownBySessionUser.set(cooldownKey, now);

    let executionPayload;
    if (strategy === "code_execution") {
      const visibleTestCases = (Array.isArray(questionDoc.testCases) ? questionDoc.testCases : []).filter(
        (testcase) => testcase?.isHidden !== true
      );
      console.log(
        "[previewQuestionLookup] run-preview: resolved coding question",
        buildPreviewLookupLogContext({
          route: "run-preview",
          sessionId,
          currentRoundIndex,
          currentQuestionIndex,
          roundType: roundTypeForLookup,
          slotQuestionId: questionId,
          slotQuestionText: questionSlot?.question || "",
          rootQuestionText: session?.currentQuestion || "",
          resolvedQuestionId: questionDoc?.questionId || "",
          resolvedQuestionText: questionDoc?.question || "",
          strategy,
          visibleCount: visibleTestCases.length,
          totalTestCases: Array.isArray(questionDoc?.testCases) ? questionDoc.testCases.length : 0,
          hasSqlMetadata: Boolean(questionDoc?.sqlMetadata),
        })
      );
      if (visibleTestCases.length === 0) {
        console.warn(
          "[previewQuestionLookup] run-preview: zero visible coding testcases",
          buildPreviewLookupLogContext({
            route: "run-preview",
            sessionId,
            currentRoundIndex,
            currentQuestionIndex,
            roundType: roundTypeForLookup,
            slotQuestionId: questionId,
            slotQuestionText: questionSlot?.question || "",
            rootQuestionText: session?.currentQuestion || "",
            resolvedQuestionId: questionDoc?.questionId || "",
            resolvedQuestionText: questionDoc?.question || "",
            strategy,
            visibleCount: 0,
            totalTestCases: Array.isArray(questionDoc?.testCases) ? questionDoc.testCases.length : 0,
            hasSqlMetadata: Boolean(questionDoc?.sqlMetadata),
          })
        );
        return res.status(400).json({
          success: false,
          message: "No visible testcases configured for this question preview.",
        });
      }
      executionPayload = await executeCode({
        language: normalizeExecutionLanguage(language),
        code,
        testCases: visibleTestCases,
        functionSignature: questionDoc?.dsaMetadata?.functionSignature || "",
        jobId: `preview-${sessionId}-${currentRoundIndex}-${currentQuestionIndex}-${Date.now()}`,
      });
    } else {
      return res.status(400).json({
        success: false,
        message:
          "Code preview is only available for coding (DSA) questions. Theoretical SQL and other text rounds are evaluated after submit.",
      });
    }

    const previewPath = `rounds.${currentRoundIndex}.questions.${currentQuestionIndex}.previewRunCount`;
    const runCountFilter =
      runCount === 0
        ? {
            $or: [{ [previewPath]: 0 }, { [previewPath]: { $exists: false } }],
          }
        : { [previewPath]: runCount };
    const updateResult = await mongoose.connection.collection("interviewsessions").updateOne(
      {
        _id: session._id,
        ...runCountFilter,
      },
      {
        $inc: { [previewPath]: 1 },
      }
    );
    if (!updateResult?.matchedCount) {
      return res.status(409).json({
        success: false,
        message: "Preview run state changed. Please retry.",
      });
    }

    const remainingRuns = Math.max(0, PREVIEW_RUN_LIMIT_PER_QUESTION - (runCount + 1));
    console.log("[runPreview] completed", {
      sessionId,
      questionId: questionDoc?.questionId || "",
      remainingRuns,
      strategy,
      status: executionPayload?.status,
    });
    console.log("[previewExecution] status", {
      sessionId,
      questionId: questionDoc?.questionId || "",
      status: executionPayload?.status,
    });

    return res.json({
      success: true,
      remainingRuns,
      execution: {
        status: executionPayload?.status,
        error: typeof executionPayload?.error === "string" ? executionPayload.error : "",
        passedCount: Number(executionPayload?.passedCount) || 0,
        failedCount: Number(executionPayload?.failedCount) || 0,
        totalCount: Number(executionPayload?.totalCount) || 0,
        executionTime: Number(executionPayload?.executionTime) || 0,
        userDebugOutput:
          typeof executionPayload?.userDebugOutput === "string" ? executionPayload.userDebugOutput : "",
        results: Array.isArray(executionPayload?.results)
          ? executionPayload.results.map((item) => ({
              passed: item?.passed === true,
              isHidden: Boolean(item?.isHidden),
              input: item?.input,
              expectedOutput: item?.expectedOutput,
              actualOutput: item?.actualOutput,
              error: item?.error || "",
              executionTime: Number(item?.executionTime) || 0,
            }))
          : [],
      },
    });
  } catch (error) {
    console.error("[runPreview] failed", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to run preview." });
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
    const activeQuestionId = String(slotNow?.questionId || "").trim();
    const activeQuestionText = String(slotNow?.question || effectiveCurrentQuestion || "").trim();
    const previewQuestionDoc = await resolveInterviewQuestionDoc({
      questionId: activeQuestionId,
      questionText: activeQuestionText,
      roundType,
      includeFullDoc: false,
    });
    console.log(
      "[previewQuestionLookup] interview-status: resolved question",
      buildPreviewLookupLogContext({
        route: "interview-status",
        sessionId,
        currentRoundIndex,
        currentQuestionIndex,
        roundType,
        slotQuestionId: activeQuestionId,
        slotQuestionText: slotNow?.question || "",
        rootQuestionText: effectiveCurrentQuestion || "",
        resolvedQuestionId: previewQuestionDoc?.questionId || "",
        resolvedQuestionText: previewQuestionDoc?.question || "",
        strategy: slotNow?.evaluationStrategy || "",
        visibleCount: Array.isArray(previewQuestionDoc?.testCases)
          ? previewQuestionDoc.testCases.filter((testcase) => testcase?.isHidden !== true).length
          : 0,
        totalTestCases: Array.isArray(previewQuestionDoc?.testCases)
          ? previewQuestionDoc.testCases.length
          : 0,
        hasSqlMetadata: Boolean(previewQuestionDoc?.sqlMetadata),
      })
    );
    if (!activeQuestionId && slotNow && previewQuestionDoc?.questionId) {
      const slotQuestionIdPath = `rounds.${currentRoundIndex}.questions.${currentQuestionIndex}.questionId`;
      await mongoose.connection.collection("interviewsessions").updateOne(
        {
          _id: session._id,
          [slotQuestionIdPath]: { $exists: false },
        },
        {
          $set: { [slotQuestionIdPath]: String(previewQuestionDoc.questionId).trim() },
        }
      );
    }
    const visibleTestCases = Array.isArray(previewQuestionDoc?.testCases)
      ? previewQuestionDoc.testCases
          .filter((testcase) => testcase?.isHidden !== true)
          .map((testcase) => ({
            input: testcase?.input ?? null,
            expectedOutput: testcase?.expectedOutput ?? null,
            weight: Number(testcase?.weight) || 1,
          }))
      : [];
    const questionUrl =
      String(slotNow?.questionUrl || "").trim() ||
      String(previewQuestionDoc?.url || "").trim();
    const previewRunCount = Number(slotNow?.previewRunCount) || 0;
    const previewRunsRemaining = Math.max(0, PREVIEW_RUN_LIMIT_PER_QUESTION - previewRunCount);
    const previewSqlContext = null;

    const sessionInterviewStatus = session.state;
    const roundCompleted =
      sessionInterviewStatus !== INTERVIEW_STATES.INTERVIEW_COMPLETE &&
      session.roundStatus === "COMPLETED" &&
      !hasActiveQuestion;
    const nextRoundAvailable =
      roundCompleted && currentRoundIndex + 1 < rounds.length;
    const fb = currentRoundDoc?.feedback;
    let roundFeedback = null;
    if (roundCompleted && fb) {
      const dsaRaw = fb.dsaRoundStats;
      const dsaRoundStats =
        dsaRaw && typeof dsaRaw === "object"
          ? {
              totalQuestions: Number(dsaRaw.totalQuestions),
              answeredCorrectly: Number(dsaRaw.answeredCorrectly),
              partiallyAnswered: Number(dsaRaw.partiallyAnswered),
              notAnswered: Number(dsaRaw.notAnswered),
            }
          : null;
      const dsaValid =
        dsaRoundStats &&
        Number.isFinite(dsaRoundStats.totalQuestions) &&
        Number.isFinite(dsaRoundStats.answeredCorrectly) &&
        Number.isFinite(dsaRoundStats.partiallyAnswered) &&
        Number.isFinite(dsaRoundStats.notAnswered);

      let topicsCoveredThisRound = Array.isArray(fb.topicsCoveredThisRound)
        ? fb.topicsCoveredThisRound.map((t) => String(t || "").trim()).filter(Boolean)
        : [];

      if (dsaValid && isDsaInterviewRoundType(currentRoundDoc?.type) && topicsCoveredThisRound.length === 0) {
        topicsCoveredThisRound = await collectTopicsForCompletedCodingRound(currentRoundDoc);
      }

      roundFeedback = {
        score: typeof fb.score === "number" ? fb.score : null,
        strengths: Array.isArray(fb.strengths) ? fb.strengths : [],
        weaknesses: Array.isArray(fb.weaknesses) ? fb.weaknesses : [],
        summary: typeof fb.summary === "string" ? fb.summary : "",
        improvementTips: Array.isArray(fb.improvementTips) ? fb.improvementTips : [],
        dsaRoundStats: dsaValid ? dsaRoundStats : null,
        topicsCoveredThisRound,
      };
    }
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
      if (isDsaInterviewRoundType(r.type)) {
        questionCount = Math.min(3, questionCount);
      }
      return { roundNumber, questionCount };
    });

    const questionsPlannedThisRoundRaw =
      typeof currentRoundDoc?.questionCount === "number" &&
      Number.isFinite(currentRoundDoc.questionCount)
        ? Math.min(5, Math.max(3, Math.round(currentRoundDoc.questionCount)))
        : roundsQuestionSummary[currentRoundIndex]?.questionCount ??
          Math.max(Array.isArray(currentRoundDoc?.questions) ? currentRoundDoc.questions.length : 0, 3);
    const questionsPlannedThisRound = isDsaInterviewRoundType(currentRoundDoc?.type)
      ? Math.min(3, questionsPlannedThisRoundRaw)
      : questionsPlannedThisRoundRaw;

    const currentQuestionNumberWithinRound = currentQuestionIndex + 1;

    const lastQuestionCanReattempt =
      exposePrevFeedback &&
      normalizedQuestionAttempts(prevQuestion).length === 1 &&
      session.state !== INTERVIEW_STATES.INTERVIEW_COMPLETE &&
      !isProcessing;

    const slotEvalStrat = String(slotNow?.evaluationStrategy || "").toLowerCase();
    const hasCodingTests =
      Array.isArray(previewQuestionDoc?.testCases) && previewQuestionDoc.testCases.length > 0;
    const roundLooksDsa = String(roundType || "").toLowerCase().includes("dsa");
    const treatSlotAsCodeExecution =
      slotEvalStrat === "code_execution" ||
      (slotEvalStrat === "" && hasCodingTests && roundLooksDsa);

    const supportedCodingLanguages = treatSlotAsCodeExecution
      ? resolveSupportedCodingLanguages(
          slotNow,
          "code_execution",
          previewQuestionDoc?.dsaMetadata || null
        )
      : [];

    return res.json({
      status: toClientStatus(session.state),
      currentRound: session.currentRound,
      currentQuestion: effectiveCurrentQuestion,
      questionUrl,
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
      lastCodeExecutionSummary: exposePrevFeedback
        ? buildLastCodeExecutionSummary(prevQuestion?.evaluationTrace)
        : null,
      lastQuestionCanReattempt,
      roundStatus: currentRoundDoc?.status ?? session.roundStatus ?? null,
      interviewStatus: toClientInterviewStatus(session.state),
      roundType: roundType ?? null,
      roundsQuestionSummary,
      questionsPlannedThisRound,
      currentQuestionNumberWithinRound,
      previewRunCount,
      previewRunsRemaining,
      visibleTestCases,
      supportedCodingLanguages,
      codingFunctionSignature: previewQuestionDoc?.dsaMetadata?.functionSignature || "",
      codingStarterCode: previewQuestionDoc?.dsaMetadata?.starterCode || "",
      codingQuestionId: activeQuestionId || "",
      questionTopics: Array.isArray(previewQuestionDoc?.topics) ? previewQuestionDoc.topics : [],
      questionSubtopics: Array.isArray(previewQuestionDoc?.subtopics) ? previewQuestionDoc.subtopics : [],
      questionCompanyTags: Array.isArray(previewQuestionDoc?.companyTags)
        ? previewQuestionDoc.companyTags
        : [],
      questionComplexity: extractQuestionComplexityForClient(previewQuestionDoc?.complexity),
      previewSqlContext,
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
      questionUrl: String(roundStart.questionUrl || "").trim(),
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

