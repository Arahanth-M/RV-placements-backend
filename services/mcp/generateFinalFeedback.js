import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";

const TOOL_FINAL_FEEDBACK_MODEL =
  process.env.GROQ_TOOL_MODEL || "llama-3.1-8b-instant";

const toSafeString = (value) => {
  return typeof value === "string" ? value.trim() : "";
};

const normalizeStringArray = (value) => {
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
  ];
};

const safeString = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * MCP tool: generateFinalFeedback
 * Generates final strengths/weaknesses/improvement plan from interview transcript.
 */
export const generateFinalFeedback = async ({ transcript, companyContext = {} }) => {
  const safeTranscript = Array.isArray(transcript) ? transcript : [];

  if (safeTranscript.length === 0) {
    return {
      strengths: [],
      weaknesses: [],
      improvementPlan: [],
      patterns: [],
      verdict: "needs_improvement",
      strongestArea: "",
      weakestArea: "",
      overallStrength: "",
      overallWeakness: "",
      summaryFeedback: "",
      companyRoadmap: [],
    };
  }

  // Compute average score (if available)
  const scores = safeTranscript
    .map((item) => Number(item?.score))
    .filter((s) => Number.isFinite(s));

  const avgScore =
    scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0;

  const messages = [
    {
      role: "system",
      content:
        "You are a strict but fair interview coach. Your job is to analyze interview performance deeply and provide realistic, actionable feedback. Return strict JSON only. No markdown. No extra text.",
    },
    {
      role: "user",
      content: `Analyze the full interview performance.

Average score: ${avgScore}/10

Company context (use for company-specific roadmap; do not invent roles or guarantees):
${JSON.stringify({
  name: companyContext?.name || companyContext?.companyName,
  rounds: companyContext?.rounds || [],
  mustDoTopics: companyContext?.mustDoTopics || [],
  interviewQuestions: (companyContext?.interviewQuestions || []).slice?.(0, 5),
  onlineQuestions: (companyContext?.onlineQuestions || []).slice?.(0, 5),
  prevCodingQuestions: (companyContext?.prevCodingQuestions || []).slice?.(0, 5),
})}

Interview transcript JSON:
${JSON.stringify(safeTranscript)}

Generate FINAL interview feedback.

Output MUST include:
1) strengths (max 4, specific and evidence-based)
2) weaknesses (max 4, clearly explained)
3) improvementPlan (max 4, actionable steps)
4) patterns (recurring mistakes or behaviors)
5) verdict ("not_ready" | "needs_improvement" | "ready")
6) strongestArea (one short phrase)
7) weakestArea (one short phrase)
8) overallStrength — ONE clear sentence: headline strength for this candidate
9) overallWeakness — ONE clear sentence: headline gap or risk area
10) summaryFeedback — 2–4 sentences of cohesive narrative feedback (second person, professional)
11) companyRoadmap — array of 5–7 short actionable strings: concrete prep steps for interviewing at THIS company (topics, skills, practice focus). Tie to company context when possible; if context is thin, give realistic generic prep for their round types.

Guidelines:
- Base analysis on scores, answers, and feedback patterns
- Identify recurring issues (not one-off mistakes)
- Avoid generic advice
- Be concise but insightful
- Improvement plan must be practical and executable
- Roadmap must be specific enough to act on this week

Scoring guidance:
- avgScore < 6 → not_ready
- avgScore 6–8 → needs_improvement
- avgScore > 8 → ready

Return STRICT JSON:
{
  "strengths": ["string"],
  "weaknesses": ["string"],
  "improvementPlan": ["string"],
  "patterns": ["string"],
  "verdict": "string",
  "strongestArea": "string",
  "weakestArea": "string",
  "overallStrength": "string",
  "overallWeakness": "string",
  "summaryFeedback": "string",
  "companyRoadmap": ["string"]
}`,
    },
  ];

  let parsed = null;

  try {
    const llmText = await callLLM(messages, {
      model: TOOL_FINAL_FEEDBACK_MODEL,
    });
    parsed = parseJSONResponse(llmText);
  } catch (err) {
    parsed = null;
  }

  // Fallback if LLM fails
  if (!parsed) {
    return {
      strengths: [],
      weaknesses: [],
      improvementPlan: [],
      patterns: [],
      verdict:
        avgScore < 6
          ? "not_ready"
          : avgScore <= 8
          ? "needs_improvement"
          : "ready",
      strongestArea: "",
      weakestArea: "",
      overallStrength: "",
      overallWeakness: "",
      summaryFeedback: "",
      companyRoadmap: [],
    };
  }

  const strengths = normalizeStringArray(parsed?.strengths).slice(0, 4);
  const weaknesses = normalizeStringArray(parsed?.weaknesses).slice(0, 4);
  const companyRoadmap = normalizeStringArray(parsed?.companyRoadmap).slice(0, 8);
  const overallStrength =
    safeString(parsed?.overallStrength) ||
    safeString(parsed?.strongestArea) ||
    strengths[0] ||
    "";
  const overallWeakness =
    safeString(parsed?.overallWeakness) ||
    safeString(parsed?.weakestArea) ||
    weaknesses[0] ||
    "";

  return {
    strengths,
    weaknesses,
    improvementPlan: normalizeStringArray(parsed?.improvementPlan).slice(0, 4),
    patterns: normalizeStringArray(parsed?.patterns).slice(0, 4),
    verdict: safeString(parsed?.verdict) || "needs_improvement",
    strongestArea: safeString(parsed?.strongestArea),
    weakestArea: safeString(parsed?.weakestArea),
    overallStrength,
    overallWeakness,
    summaryFeedback: safeString(parsed?.summaryFeedback),
    companyRoadmap,
  };
};

export default generateFinalFeedback;