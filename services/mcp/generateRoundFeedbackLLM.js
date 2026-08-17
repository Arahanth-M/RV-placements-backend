import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";
import { logInterviewDsaLlmDebug } from "../interviewDebugLog.js";
import { GROQ_QUALITY_MODEL } from "../../config/groqModels.js";

const TOOL_ROUND_FEEDBACK_MODEL =
  process.env.GROQ_TOOL_MODEL || GROQ_QUALITY_MODEL;

const toSafeString = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeStringArray = (value, max = 4) => {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => {
          if (typeof item === "string") return item.trim();
          if (item && typeof item === "object") {
            return toSafeString(item.content || item.title || item.point);
          }
          return "";
        })
        .filter(Boolean)
    ),
  ].slice(0, max);
};

const buildRoundTranscript = (round) => {
  const questions = Array.isArray(round?.questions) ? round.questions : [];
  return questions.map((q, idx) => ({
    index: idx + 1,
    prompt: toSafeString(q?.question).slice(0, 1200),
    answerPreview: toSafeString(q?.answer).slice(0, 2000),
    score: Number.isFinite(Number(q?.score)) ? Number(q.score) : null,
    feedbackPreview: toSafeString(q?.feedback).slice(0, 800),
  }));
};

/**
 * LLM-backed per-round summary for non–code-execution rounds (e.g. SQL, HR, system design).
 */
export const generateRoundFeedbackLLM = async ({ roundData, companyContext = {} }) => {
  const round = roundData || {};
  const transcript = buildRoundTranscript(round);
  const roundType = toSafeString(round?.type) || "General";
  const roundNumber = Number(round?.roundNumber) || 1;

  logInterviewDsaLlmDebug("round_feedback_llm_invoke", {
    roundNumber,
    roundType,
    transcriptSlots: transcript.length,
    note: "If this fires for a DSA-only round, round.type likely did not match code-execution interview heuristics.",
  });

  const avgFromAggregate = Number(round?.aggregate?.averageScore);
  const scores = transcript.map((t) => t.score).filter((s) => s != null && Number.isFinite(s));
  const avgScore = Number.isFinite(avgFromAggregate)
    ? Math.round(avgFromAggregate * 10) / 10
    : scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0;

  const messages = [
    {
      role: "system",
      content:
        "You are a concise interview coach. Analyze this single interview round only. Return strict JSON only. No markdown. No extra text.",
    },
    {
      role: "user",
      content: `Round ${roundNumber} type: "${roundType}".

Average score (when scores exist): ${avgScore}/10

Company context (optional, for tone only — do not invent offers or guarantees):
${JSON.stringify({
  name: companyContext?.name || companyContext?.companyName,
  mustDoTopics: (companyContext?.mustDoTopics || []).slice(0, 12),
})}

Per-question transcript (JSON):
${JSON.stringify(transcript)}

Produce round-level feedback for THIS round only.

Output MUST be valid JSON with:
- "summary": 2–4 sentences, second person, professional
- "strengths": up to 4 short bullet strings, evidence-based
- "weaknesses": up to 4 short bullet strings (label as areas to improve)
- "improvementTips": up to 4 actionable strings for next practice session

Guidelines:
- Ground claims in the transcript and scores
- Avoid generic filler
- Match the round type (${roundType}) — e.g. SQL rounds: comment on query logic, correctness, readability if visible from answers`,
    },
  ];

  let parsed = null;
  try {
    const llmText = await callLLM(messages, {
      model: TOOL_ROUND_FEEDBACK_MODEL,
    });
    parsed = parseJSONResponse(llmText);
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const summary = toSafeString(parsed.summary);
  if (!summary) return null;

  return {
    summary,
    strengths: normalizeStringArray(parsed.strengths, 4),
    weaknesses: normalizeStringArray(parsed.weaknesses, 4),
    improvementTips: normalizeStringArray(parsed.improvementTips, 4),
  };
};

export default generateRoundFeedbackLLM;
