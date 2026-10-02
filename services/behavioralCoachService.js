/**
 * Lightweight STAR / HR practice (Behavioral Answer Coach).
 * Theme-locked question generation + evaluateBehavioralLLM scoring.
 */
import crypto from "crypto";
import redis, { connectRedis } from "../src/utils/redisClient.js";
import BehavioralCoachAttempt from "../models/BehavioralCoachAttempt.js";
import { resolveRoundAbout } from "../config/interviewRoundFocus.js";
import { callLLM } from "./llmClient.js";
import { parseJSONResponse } from "../utils/parseJSONResponse.js";
import { evaluateAnswer } from "./mcp/evaluateAnswer.js";

const HISTORY_LIMIT = 40;

const PRACTICE_TTL_SEC = 45 * 60;
const memoryStore = new Map();

const STAR_KEYS = [
  {
    id: "situation",
    label: "Situation",
    subscoreKey: "situationClarity",
    tip: "Set the scene: context, stakes, and who was involved.",
  },
  {
    id: "task",
    label: "Task",
    subscoreKey: "taskClarity",
    tip: "State your responsibility or goal clearly — what you needed to achieve.",
  },
  {
    id: "action",
    label: "Action",
    subscoreKey: "actionOwnership",
    tip: "Say what *you* did — ownership, decisions, and concrete steps.",
  },
  {
    id: "result",
    label: "Result",
    subscoreKey: "resultSpecificity",
    tip: "Close with an outcome — metrics, impact, or what changed.",
  },
  {
    id: "reflection",
    label: "Reflection",
    subscoreKey: "reflection",
    tip: "What you learned or would do differently next time.",
  },
];

/** Why-company uses motivation structure — same subscore keys, different coaching labels. */
const WHY_COMPANY_KEYS = [
  {
    id: "situation",
    label: "Motivation",
    subscoreKey: "situationClarity",
    tip: "Say what draws you to this kind of company/role — products, mission, or craft.",
  },
  {
    id: "action",
    label: "Fit",
    subscoreKey: "actionOwnership",
    tip: "Connect your skills, projects, or interests to what the role needs.",
  },
  {
    id: "result",
    label: "Evidence",
    subscoreKey: "resultSpecificity",
    tip: "Be specific — research, a product detail, or a concrete experience that backs the fit.",
  },
  {
    id: "reflection",
    label: "Aspiration",
    subscoreKey: "reflection",
    tip: "Close with what you want to learn or contribute in the first months.",
  },
];

const VALID_FOCUS_IDS = new Set([
  "general",
  "teamwork",
  "conflict",
  "leadership",
  "failure",
  "why_company",
]);

function isWhyCompanyFocus(focus) {
  return normalizeFocus(focus) === "why_company";
}

function breakdownKeysForFocus(focus) {
  return isWhyCompanyFocus(focus) ? WHY_COMPANY_KEYS : STAR_KEYS;
}

function toSafeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Default STAR rubric so grading always treats the answer as a behavioral story. */
const DEFAULT_STAR_EXPECTED_POINTS = [
  {
    text: "Clear situation or context with stakes and people involved",
    category: "situationClarity",
    expectedAnswerMode: "story",
    importance: "mustHave",
  },
  {
    text: "Clear task, responsibility, or goal in that situation",
    category: "taskClarity",
    expectedAnswerMode: "story",
    importance: "mustHave",
  },
  {
    text: "Personal ownership — what the candidate specifically did",
    category: "actionOwnership",
    expectedAnswerMode: "story",
    importance: "mustHave",
  },
  {
    text: "Concrete result, impact, or measurable outcome",
    category: "resultSpecificity",
    expectedAnswerMode: "story",
    importance: "mustHave",
  },
  {
    text: "Brief reflection or learning from the experience",
    category: "reflection",
    expectedAnswerMode: "story",
    importance: "niceToHave",
  },
];

/** Why-company rubric — motivation / fit, not a past STAR story. */
const DEFAULT_WHY_EXPECTED_POINTS = [
  {
    text: "Clear motivation for this kind of company, product, or role",
    category: "situationClarity",
    expectedAnswerMode: "story",
    importance: "mustHave",
  },
  {
    text: "How the candidate’s skills or interests fit what the role needs",
    category: "actionOwnership",
    expectedAnswerMode: "story",
    importance: "mustHave",
  },
  {
    text: "Specific evidence — research, product detail, or relevant experience",
    category: "resultSpecificity",
    expectedAnswerMode: "story",
    importance: "mustHave",
  },
  {
    text: "What they want to learn or contribute early on",
    category: "reflection",
    expectedAnswerMode: "story",
    importance: "niceToHave",
  },
];

function ensureExpectedPoints(rawPoints, focus = "general") {
  const defaults = isWhyCompanyFocus(focus)
    ? DEFAULT_WHY_EXPECTED_POINTS
    : DEFAULT_STAR_EXPECTED_POINTS;
  const list = Array.isArray(rawPoints) ? rawPoints : [];
  const normalized = list
    .map((point) => {
      if (!point || typeof point !== "object") return null;
      const text = toSafeString(point.text);
      if (!text) return null;
      return {
        text,
        category: toSafeString(point.category, "coverage") || "coverage",
        expectedAnswerMode: "story",
        importance: toSafeString(point.importance, "mustHave") || "mustHave",
      };
    })
    .filter(Boolean);

  if (normalized.length === 0) {
    return defaults.map((p) => ({ ...p }));
  }

  const keys = breakdownKeysForFocus(focus);
  const hasStarCategory = normalized.some((p) =>
    keys.some((k) => k.subscoreKey === p.category)
  );
  if (!hasStarCategory) {
    return [...normalized, ...defaults.map((p) => ({ ...p }))];
  }
  return normalized;
}

/** Heuristic STAR signals from answer text when evaluator subscores are missing/zero. */
function extractLabeledSection(answer, label) {
  const text = toSafeString(answer);
  if (!text) return "";
  const re = new RegExp(
    `${label}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Situation|Task|Action|Result|Reflection|Motivation|Fit|Evidence|Aspiration)\\s*:|$)`,
    "i"
  );
  const match = text.match(re);
  return toSafeString(match?.[1]);
}

function heuristicStarSubscores(answer) {
  const lower = toSafeString(answer).toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean).length;
  const lengthBoost = words >= 40 ? 0.15 : words >= 20 ? 0.08 : 0;
  const taskSection = extractLabeledSection(answer, "Task");
  const resultSection = extractLabeledSection(answer, "Result");
  const reflectionSection = extractLabeledSection(answer, "Reflection");

  return {
    situationClarity: clamp01(
      (/situation|context|when i|during|project|internship|semester|team was|at my|company|situation:/.test(
        lower
      )
        ? 0.72
        : 0.32) + lengthBoost
    ),
    taskClarity: clamp01(
      (taskSection.length >= 12 ||
      /task:|my (goal|job|role|responsibility)|needed to|had to|objective|responsible for/.test(
        lower
      )
        ? 0.76
        : taskSection.length >= 5
          ? 0.55
          : 0.28) + lengthBoost
    ),
    actionOwnership: clamp01(
      (/\b(i|i'd|i’ll|i'll|my|myself)\b/.test(lower) &&
      /led|owned|implemented|decided|coordinated|built|fixed|proposed|took|handled|spoke|negotiat|action:/.test(
        lower
      )
        ? 0.78
        : /\b(i|my)\b/.test(lower) || /action:|task:/.test(lower)
          ? 0.55
          : 0.28) + lengthBoost
    ),
    resultSpecificity: clamp01(
      (resultSection.length >= 12 ||
      /\d+|%|percent|improved|reduced|increased|outcome|result|impact|delivered|resolved|shipped|result:/.test(
        lower
      )
        ? 0.75
        : resultSection.length >= 5 || /result|outcome|finally|ended up|success/.test(lower)
          ? 0.48
          : 0.28) + lengthBoost
    ),
    reflection: clamp01(
      (reflectionSection.length >= 10 ||
      /learned|next time|would (do|have)|reflection|takeaway|realized|going forward|reflection:/.test(
        lower
      )
        ? 0.7
        : reflectionSection.length >= 4
          ? 0.45
          : 0.22) + lengthBoost * 0.5
    ),
  };
}

function heuristicWhySubscores(answer) {
  const lower = toSafeString(answer).toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean).length;
  const lengthBoost = words >= 40 ? 0.15 : words >= 20 ? 0.08 : 0;

  return {
    situationClarity: clamp01(
      (/motivat|excit|interest|attract|why|passion|care about|drawn to|mission|product|company/.test(
        lower
      )
        ? 0.75
        : 0.35) + lengthBoost
    ),
    actionOwnership: clamp01(
      (/fit|skill|project|built|internship|course|strength|experience|i (can|have|bring)|my (background|interest)/.test(
        lower
      )
        ? 0.74
        : /\b(i|my)\b/.test(lower)
          ? 0.5
          : 0.28) + lengthBoost
    ),
    resultSpecificity: clamp01(
      (/for example|specifically|research|read about|product|feature|stack|domain|evidence:|\d+/.test(
        lower
      )
        ? 0.76
        : /because|example|detail/.test(lower)
          ? 0.48
          : 0.28) + lengthBoost
    ),
    reflection: clamp01(
      (/learn|contribute|grow|first (six|6) months|aspire|goal|want to|aspiration:/.test(lower)
        ? 0.72
        : 0.24) + lengthBoost * 0.5
    ),
  };
}

function normalizeSubscores(evaluationTrace = {}) {
  const raw = evaluationTrace?.subscores;
  if (!raw) return {};
  if (raw instanceof Map) return Object.fromEntries(raw.entries());
  if (typeof raw === "object") return { ...raw };
  return {};
}

function buildAnswerBreakdown(evaluationTrace = {}, answer = "", focus = "general") {
  const keys = breakdownKeysForFocus(focus);
  const subscores = normalizeSubscores(evaluationTrace);
  const heuristics = isWhyCompanyFocus(focus)
    ? heuristicWhySubscores(answer)
    : heuristicStarSubscores(answer);

  return keys.map((dim) => {
    const raw = Number(subscores[dim.subscoreKey]);
    const fromEval = Number.isFinite(raw) ? clamp01(raw) : 0;
    const heuristic = heuristics[dim.subscoreKey] || 0;
    // Prefer evaluator signal when present; always keep a heuristic floor so labeled
    // sections (Task / Result / Reflection) still get a visible bar.
    const score01 =
      fromEval >= 0.12 ? Math.max(fromEval, heuristic * 0.35) : Math.max(fromEval, heuristic);
    return {
      id: dim.id,
      label: dim.label,
      score: Math.round(score01 * 100),
      tip: dim.tip,
      weak: score01 < 0.45,
    };
  });
}

function normalizeFocus(raw) {
  const focus = toSafeString(raw, "general").toLowerCase();
  return VALID_FOCUS_IDS.has(focus) ? focus : "general";
}

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  try {
    await connectRedis();
    return redis;
  } catch {
    return null;
  }
}

function practiceKey(practiceId) {
  return `rvp:behavioral-coach:${String(practiceId)}`;
}

function pruneMemoryStore() {
  const now = Date.now();
  for (const [id, row] of memoryStore.entries()) {
    if (!row?.expiresAt || row.expiresAt <= now) memoryStore.delete(id);
  }
}

async function savePractice(practiceId, payload) {
  const expiresAt = Date.now() + PRACTICE_TTL_SEC * 1000;
  const row = { ...payload, expiresAt };
  pruneMemoryStore();
  memoryStore.set(String(practiceId), row);

  const r = await getRedis();
  if (!r) return;
  try {
    await r.set(practiceKey(practiceId), JSON.stringify(row), { EX: PRACTICE_TTL_SEC });
  } catch (err) {
    console.warn("[behavioralCoach] redis save failed:", err?.message || err);
  }
}

async function loadPractice(practiceId) {
  const id = String(practiceId || "").trim();
  if (!id) return null;

  const r = await getRedis();
  if (r) {
    try {
      const raw = await r.get(practiceKey(id));
      if (raw && typeof raw === "string") {
        const parsed = JSON.parse(raw);
        if (parsed?.expiresAt && parsed.expiresAt > Date.now()) return parsed;
      }
    } catch (err) {
      console.warn("[behavioralCoach] redis load failed:", err?.message || err);
    }
  }

  pruneMemoryStore();
  const mem = memoryStore.get(id);
  if (mem?.expiresAt && mem.expiresAt > Date.now()) return mem;
  if (mem) memoryStore.delete(id);
  return null;
}

async function deletePractice(practiceId) {
  const id = String(practiceId || "").trim();
  if (!id) return;
  memoryStore.delete(id);
  const r = await getRedis();
  if (!r) return;
  try {
    await r.del(practiceKey(id));
  } catch {
    /* ignore */
  }
}

/** Theme-specific interviewer prompts + keyword checks so questions match the selected focus. */
const THEME_QUESTION_GUIDANCE = {
  general: {
    label: "general behavioral",
    mustAskAbout:
      "a real past experience suitable for a fresher HR round (ownership, collaboration, or learning)",
    keywords: ["tell me", "share", "situation", "experience", "example", "time"],
    fallbacks: [
      "Can you walk me through a recent situation where you had to take ownership of a problem, and what result you achieved?",
      "Tell me about a time you worked through an ambiguous task and how you decided what to do next.",
      "Share an example of a challenge you faced during a project or internship and how you handled it.",
    ],
  },
  teamwork: {
    label: "teamwork / collaboration",
    mustAskAbout:
      "collaborating with teammates — coordination, shared goals, helping others, or group project dynamics",
    keywords: [
      "team",
      "teammate",
      "collaborat",
      "group",
      "together",
      "peer",
      "classmate",
      "partner",
    ],
    fallbacks: [
      "Tell me about a time you collaborated with teammates on a project — what was your role, and how did the team deliver?",
      "Describe a situation where you had to work closely with others who had different working styles. How did you keep the team moving?",
      "Share an example when your team was stuck and you helped the group get unblocked. What did you do?",
    ],
  },
  conflict: {
    label: "conflict / difficult situations",
    mustAskAbout:
      "disagreement, tension, or a difficult interpersonal situation and how they resolved it",
    keywords: [
      "conflict",
      "disagreement",
      "difficult",
      "disagree",
      "tension",
      "pushback",
      "argument",
      "friction",
      "challenging person",
    ],
    fallbacks: [
      "Tell me about a time you disagreed with a teammate or peer. How did you handle the conflict, and what was the outcome?",
      "Describe a situation where there was friction on a project. What did you do to resolve it?",
      "Share an example of receiving critical feedback you didn’t initially agree with. How did you respond?",
    ],
  },
  leadership: {
    label: "leadership / ownership",
    mustAskAbout:
      "leading others, taking initiative, mentoring, or owning a decision without needing a formal title",
    keywords: [
      "lead",
      "led",
      "leadership",
      "initiative",
      "owned",
      "ownership",
      "mentor",
      "guided",
      "took charge",
      "coordinat",
    ],
    fallbacks: [
      "Tell me about a time you took initiative or led a piece of work without being asked — what did you own, and what changed?",
      "Describe a situation where you guided teammates or juniors through a task. How did you approach it?",
      "Share an example when you had to make a call for the group under time pressure. What did you decide and why?",
    ],
  },
  failure: {
    label: "failure / learning from mistakes",
    mustAskAbout:
      "a real failure, mistake, or setback and what they learned or changed afterward",
    keywords: [
      "fail",
      "mistake",
      "wrong",
      "setback",
      "learned",
      "didn’t work",
      "didn't work",
      "went poorly",
      "missed",
      "error",
    ],
    fallbacks: [
      "Tell me about a time something you tried didn’t work out. What went wrong, and what did you change afterward?",
      "Describe a mistake you made on a project or assignment. How did you recover, and what did you learn?",
      "Share an example of a setback during prep or a project. What would you do differently next time?",
    ],
  },
  why_company: {
    label: "motivation / why this company or role",
    mustAskAbout:
      "why they want this kind of company/role, what attracts them, and how it connects to their goals (not a random past project)",
    keywords: [
      "why",
      "motivat",
      "interest",
      "attract",
      "company",
      "role",
      "career",
      "join",
      "fit",
      "excited",
    ],
    fallbacks: [
      "What kind of company or product environment are you most excited to join as a fresher, and why does that fit your goals?",
      "Walk me through why you’re interested in this role — what experiences or interests led you here?",
      "If you join a product engineering team tomorrow, what would you want to learn in the first six months, and why?",
    ],
  },
};

function themeLooksAligned(question, focus) {
  const q = toSafeString(question).toLowerCase();
  if (!q) return false;
  const guidance = THEME_QUESTION_GUIDANCE[focus] || THEME_QUESTION_GUIDANCE.general;
  if (focus === "general") return q.length >= 40;
  return guidance.keywords.some((kw) => q.includes(kw));
}

function pickThemeFallbackQuestion(focus) {
  const guidance = THEME_QUESTION_GUIDANCE[focus] || THEME_QUESTION_GUIDANCE.general;
  const list = guidance.fallbacks;
  return list[Math.floor(Math.random() * list.length)] || list[0];
}

async function generateThemeLockedQuestion(focus) {
  const theme = normalizeFocus(focus);
  const guidance = THEME_QUESTION_GUIDANCE[theme] || THEME_QUESTION_GUIDANCE.general;
  const roundAbout = resolveRoundAbout("HR", theme);

  try {
    const llmText = await callLLM([
      {
        role: "system",
        content:
          "You are an HR interviewer for campus fresher hiring. Return strict JSON only. No markdown.",
      },
      {
        role: "user",
        content: `Generate ONE behavioral interview question for a fresher.

Theme id: ${theme}
Theme label: ${guidance.label}
Theme focus (must drive the question): ${roundAbout}
The question MUST specifically ask about: ${guidance.mustAskAbout}

Rules:
1) The question must clearly be about THIS theme only — do not ask a generic unrelated behavioral question.
2) Prefer natural HR phrasing like "Tell me about a time..." or "Can you walk me through...".
3) One or two sentences max.
4) Suitable for a fresher (college project, internship, club, coursework, or campus experience is OK).
5) Do not mention company names unless theme is why_company.
6) For why_company, ask about motivation/fit/interest in the role or company type — not a random conflict/leadership story.
7) For why_company expectedPoints, score motivation (situationClarity), role fit (actionOwnership), specific evidence (resultSpecificity), and early goals (reflection).

Return JSON:
{
  "question": "string",
  "expectedPoints": [
    { "text": "string", "category": "situationClarity|taskClarity|actionOwnership|resultSpecificity|reflection", "importance": "mustHave|goodToHave" }
  ]
}`,
      },
    ]);

    const parsed = parseJSONResponse(llmText);
    const question = toSafeString(parsed?.question);
    if (question && themeLooksAligned(question, theme)) {
      return {
        question,
        expectedPoints: Array.isArray(parsed?.expectedPoints) ? parsed.expectedPoints : [],
      };
    }

    // One repair pass if the model drifted off-theme.
    if (question) {
      const repairText = await callLLM([
        {
          role: "system",
          content: "Rewrite the interview question. Return strict JSON only.",
        },
        {
          role: "user",
          content: `This question drifted off theme:
"${question}"

Rewrite it so it ONLY covers theme "${guidance.label}" (${roundAbout}).
Must ask about: ${guidance.mustAskAbout}

Return JSON: { "question": "string" }`,
        },
      ]);
      const repaired = toSafeString(parseJSONResponse(repairText)?.question);
      if (repaired && themeLooksAligned(repaired, theme)) {
        return {
          question: repaired,
          expectedPoints: Array.isArray(parsed?.expectedPoints) ? parsed.expectedPoints : [],
        };
      }
    }
  } catch (err) {
    console.warn("[behavioralCoach] theme question LLM failed:", err?.message || err);
  }

  return {
    question: pickThemeFallbackQuestion(theme),
    expectedPoints: [],
  };
}

function coachingHints(breakdown, missingRubricPoints = []) {
  const weak = breakdown.filter((d) => d.weak).map((d) => d.label);
  const hints = [];
  if (weak.length) {
    hints.push(`Strengthen: ${weak.join(", ")}.`);
  }
  for (const dim of breakdown) {
    if (dim.weak) hints.push(dim.tip);
  }
  const misses = (Array.isArray(missingRubricPoints) ? missingRubricPoints : [])
    .map((x) => toSafeString(x))
    .filter(Boolean)
    .slice(0, 3);
  for (const miss of misses) {
    hints.push(`Cover this: ${miss}`);
  }
  return [...new Set(hints)].slice(0, 6);
}

function scoreFromStarBreakdown(breakdown) {
  const rows = Array.isArray(breakdown) ? breakdown : [];
  if (!rows.length) return 1;

  // Overall /10 is derived from STAR % so the headline score matches the bars.
  const weights = {
    situation: 0.2,
    task: 0.15,
    action: 0.25,
    result: 0.25,
    reflection: 0.15,
  };

  let weighted = 0;
  let weightSum = 0;
  for (const row of rows) {
    const w = weights[row.id] ?? 0.25;
    const pct = Math.max(0, Math.min(100, Number(row.score) || 0));
    weighted += pct * w;
    weightSum += w;
  }

  const avgPct = weightSum > 0 ? weighted / weightSum : 0;
  return Math.max(1, Math.min(10, Math.round(avgPct / 10)));
}

/** Drop score lines from narrative feedback — score is shown separately in the UI. */
function stripScoreFromFeedback(feedback) {
  const text = toSafeString(feedback);
  if (!text) return "";
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^score\s*:\s*\d+(\.\d+)?\s*\/\s*10\b/i.test(line))
    .join("\n\n")
    .trim();
}

/**
 * @param {{ userId: string, focus?: string }} input
 */
export async function startBehavioralCoachPractice(input = {}) {
  const userId = toSafeString(input.userId);
  if (!userId) {
    const err = new Error("Unauthorized");
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const focus = normalizeFocus(input.focus);
  const roundAbout = resolveRoundAbout("HR", focus);
  const themeLabel =
    THEME_QUESTION_GUIDANCE[focus]?.label || THEME_QUESTION_GUIDANCE.general.label;

  const generated = await generateThemeLockedQuestion(focus);

  const question = toSafeString(generated?.question);
  if (!question) {
    const err = new Error(
      "Could not generate a behavioral question for this theme. Please try again."
    );
    err.code = "QUESTION_UNAVAILABLE";
    throw err;
  }

  const practiceId = crypto.randomUUID();
  const expectedPoints = ensureExpectedPoints(generated.expectedPoints, focus);

  await savePractice(practiceId, {
    userId,
    focus,
    question,
    expectedPoints,
    questionId: "",
    evaluationStrategy: "behavioral_llm",
  });

  const answerTip = isWhyCompanyFocus(focus)
    ? `Theme: ${themeLabel}. Use Motivation, Fit, Evidence, and Aspiration — not a past STAR story. Focus: ${roundAbout}.`
    : `Theme: ${themeLabel}. Answer in STAR boxes — Situation, Task, Action, Result (+ optional Reflection). Focus: ${roundAbout}.`;

  return {
    practiceId,
    focus,
    question,
    tip: answerTip,
  };
}

/**
 * @param {{ userId: string, practiceId: string, answer: string }} input
 */
export async function evaluateBehavioralCoachPractice(input = {}) {
  const userId = toSafeString(input.userId);
  const practiceId = toSafeString(input.practiceId);
  const answer = toSafeString(input.answer);

  if (!userId) {
    const err = new Error("Unauthorized");
    err.code = "UNAUTHORIZED";
    throw err;
  }
  if (!practiceId) {
    const err = new Error("practiceId is required");
    err.code = "INVALID_PRACTICE";
    throw err;
  }
  if (answer.length < 20) {
    const err = new Error(
      "Write a fuller answer (at least a few sentences in the answer boxes)."
    );
    err.code = "ANSWER_TOO_SHORT";
    throw err;
  }

  const practice = await loadPractice(practiceId);
  if (!practice || practice.userId !== userId) {
    const err = new Error("Practice expired or not found. Start a new question.");
    err.code = "PRACTICE_NOT_FOUND";
    throw err;
  }

  const focus = normalizeFocus(practice.focus);
  const expectedPoints = ensureExpectedPoints(practice.expectedPoints, focus);

  // Grade as bank-style behavioral — not "generated technical" (factuality checks zero out STAR stories).
  const evaluation = await evaluateAnswer({
    evaluationStrategy: "behavioral_llm",
    answer,
    question: practice.question,
    companyContext: {
      name: "General practice",
      role: "Software Engineer / fresher candidate",
    },
    expectedPoints,
    questionSource: "retrieved",
  });

  const trace = evaluation?.evaluationTrace || {};
  const starBreakdown = buildAnswerBreakdown(trace, answer, focus);
  const hints = coachingHints(starBreakdown, trace.missingRubricPoints);
  const score = scoreFromStarBreakdown(starBreakdown);
  const matchedRubricPoints = Array.isArray(trace.matchedRubricPoints)
    ? trace.matchedRubricPoints.slice(0, 8)
    : [];
  const missingRubricPoints = Array.isArray(trace.missingRubricPoints)
    ? trace.missingRubricPoints.slice(0, 8)
    : [];
  const feedback = stripScoreFromFeedback(evaluation?.feedback);
  const verdict = toSafeString(trace.verdict || evaluation?.verdict);

  const result = {
    practiceId,
    focus: practice.focus,
    question: practice.question,
    answer,
    score,
    feedback,
    verdict,
    starBreakdown,
    coachingHints: hints,
    matchedRubricPoints,
    missingRubricPoints,
  };

  await persistCoachAttempt(userId, result);
  await deletePractice(practiceId);

  return result;
}

async function persistCoachAttempt(userId, result) {
  try {
    await BehavioralCoachAttempt.create({
      userId,
      practiceId: result.practiceId,
      focus: normalizeFocus(result.focus),
      question: toSafeString(result.question).slice(0, 2000),
      answer: toSafeString(result.answer).slice(0, 12000),
      score: Math.max(0, Math.min(10, Number(result.score) || 0)),
      feedback: toSafeString(result.feedback).slice(0, 8000),
      verdict: toSafeString(result.verdict).slice(0, 120),
      starBreakdown: Array.isArray(result.starBreakdown) ? result.starBreakdown : [],
      coachingHints: Array.isArray(result.coachingHints)
        ? result.coachingHints.slice(0, 8)
        : [],
      matchedRubricPoints: Array.isArray(result.matchedRubricPoints)
        ? result.matchedRubricPoints.slice(0, 8)
        : [],
      missingRubricPoints: Array.isArray(result.missingRubricPoints)
        ? result.missingRubricPoints.slice(0, 8)
        : [],
    });
  } catch (err) {
    console.warn("[behavioralCoach] persist attempt failed:", err?.message || err);
  }
}

function avg(nums) {
  const list = nums.filter((n) => Number.isFinite(n));
  if (!list.length) return null;
  return Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10;
}

/**
 * Past practice analytics for the signed-in user.
 * @param {{ userId: string, limit?: number }} input
 */
export async function getBehavioralCoachAnalytics(input = {}) {
  const userId = toSafeString(input.userId);
  if (!userId) {
    const err = new Error("Unauthorized");
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const limit = Math.min(
    HISTORY_LIMIT,
    Math.max(1, Number(input.limit) || HISTORY_LIMIT)
  );

  const rows = await BehavioralCoachAttempt.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const chronological = [...rows].reverse();
  const scores = chronological.map((r) => Number(r.score)).filter(Number.isFinite);

  const starTotals = {
    situation: [],
    task: [],
    action: [],
    result: [],
    reflection: [],
  };
  const labelToId = {
    situation: "situation",
    task: "task",
    action: "action",
    result: "result",
    reflection: "reflection",
    motivation: "situation",
    fit: "action",
    evidence: "result",
    aspiration: "reflection",
  };
  for (const row of chronological) {
    for (const dim of row.starBreakdown || []) {
      const fromId = dim?.id && Array.isArray(starTotals[dim.id]) ? dim.id : null;
      const fromLabel = labelToId[toSafeString(dim?.label).toLowerCase()] || null;
      const bucket = fromId || fromLabel;
      if (!bucket || !Array.isArray(starTotals[bucket])) continue;
      const n = Number(dim.score);
      if (Number.isFinite(n)) starTotals[bucket].push(n);
    }
  }

  const byFocusMap = new Map();
  for (const row of chronological) {
    const focus = normalizeFocus(row.focus);
    const cur = byFocusMap.get(focus) || { focus, count: 0, scoreSum: 0 };
    cur.count += 1;
    cur.scoreSum += Number(row.score) || 0;
    byFocusMap.set(focus, cur);
  }

  const byFocus = [...byFocusMap.values()]
    .map((row) => ({
      focus: row.focus,
      label: THEME_QUESTION_GUIDANCE[row.focus]?.label || row.focus,
      count: row.count,
      avgScore: row.count ? Math.round((row.scoreSum / row.count) * 10) / 10 : null,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    summary: {
      totalAttempts: rows.length,
      averageScore: avg(scores),
      latestScore: scores.length ? scores[scores.length - 1] : null,
      averageStar: {
        situation: avg(starTotals.situation),
        task: avg(starTotals.task),
        action: avg(starTotals.action),
        result: avg(starTotals.result),
        reflection: avg(starTotals.reflection),
      },
    },
    byFocus,
    progress: chronological.map((row) => ({
      practiceId: row.practiceId,
      focus: row.focus,
      score: row.score,
      createdAt: row.createdAt,
    })),
    attempts: rows.map((row) => ({
      id: String(row._id),
      practiceId: row.practiceId,
      focus: row.focus,
      question: row.question,
      answer: row.answer,
      score: row.score,
      feedback: row.feedback,
      verdict: row.verdict,
      starBreakdown: row.starBreakdown || [],
      coachingHints: row.coachingHints || [],
      createdAt: row.createdAt,
    })),
  };
}

export const BEHAVIORAL_COACH_STAR_KEYS = STAR_KEYS;
