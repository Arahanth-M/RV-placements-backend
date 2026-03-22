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
export const generateFinalFeedback = async ({ transcript }) => {
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

Guidelines:
- Base analysis on scores, answers, and feedback patterns
- Identify recurring issues (not one-off mistakes)
- Avoid generic advice
- Be concise but insightful
- Improvement plan must be practical and executable

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
  "weakestArea": "string"
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
    };
  }

  return {
    strengths: normalizeStringArray(parsed?.strengths).slice(0, 4),
    weaknesses: normalizeStringArray(parsed?.weaknesses).slice(0, 4),
    improvementPlan: normalizeStringArray(parsed?.improvementPlan).slice(0, 4),
    patterns: normalizeStringArray(parsed?.patterns).slice(0, 4),
    verdict: safeString(parsed?.verdict) || "needs_improvement",
    strongestArea: safeString(parsed?.strongestArea),
    weakestArea: safeString(parsed?.weakestArea),
  };
};

export default generateFinalFeedback;