import { callLLM } from "./llmClient.js";
import { parseJSONResponse } from "../utils/parseJSONResponse.js";
import { assertMergeContentValidForSubmissionType } from "./submissionEnhanceService.js";

const MAX_CONTENT_CHARS = 70000;
const ANSWER_MODEL =
  typeof process.env.GROQ_SUBMISSION_ANSWER_MODEL === "string" &&
  process.env.GROQ_SUBMISSION_ANSWER_MODEL.trim()
    ? process.env.GROQ_SUBMISSION_ANSWER_MODEL.trim()
    : typeof process.env.GROQ_SUBMISSION_ENHANCE_MODEL === "string" &&
        process.env.GROQ_SUBMISSION_ENHANCE_MODEL.trim()
      ? process.env.GROQ_SUBMISSION_ENHANCE_MODEL.trim()
      : "llama-3.3-70b-versatile";

/** OA / interview question submissions only. */
export function isSubmissionAddAnswerSupported(type) {
  return type === "onlineQuestions" || type === "interviewQuestions";
}

function parseQuestionSolution(contentStr) {
  try {
    const p = JSON.parse(contentStr);
    if (p && typeof p === "object") {
      return {
        question: String(p.question ?? "").trim(),
        solution: p.solution != null ? String(p.solution) : "",
      };
    }
  } catch {
    // fall through
  }
  return { question: String(contentStr || "").trim(), solution: "" };
}

const ANSWER_SYSTEM_PROMPT =
  "You help placement-cell reviewers answer student-submitted OA or interview questions. " +
  "Read ONLY the problem statement provided by the user. " +
  "Decide whether it is a coding/DSA problem (expects implementable code) or a conceptual question " +
  "(theory, HR, system design discussion, aptitude, etc.). " +
  'Reply with a single JSON object: {"solution": string} — no markdown fences, no extra keys. ' +
  "Rules:\n" +
  "- Do NOT rewrite or repeat the full question in the solution.\n" +
  "- For coding/DSA problems: write a complete, correct solution in C++17 (competitive-programming style). " +
  "Use appropriate #include lines, a clear function or class, and handle constraints from the statement. " +
  "After the code block, you may add 1–3 short lines on approach and time/space complexity.\n" +
  "- For non-coding problems: give a clear, accurate text answer (bullets or short paragraphs). No code unless a one-line snippet is essential.\n" +
  "- If the statement is ambiguous, state minimal assumptions, then answer.\n" +
  "- Be correct and concise; this will be published for other students.";

/**
 * Generate an answer for the submitted question. Does not persist.
 * Returns content string `{ question, solution }` for approve mergeContent.
 */
export async function generateSubmissionAnswer({ type, content }) {
  if (!isSubmissionAddAnswerSupported(type)) {
    throw new Error("Add answer is only available for OA and interview question submissions.");
  }
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Submission content is empty.");
  }
  if (content.length > MAX_CONTENT_CHARS) {
    throw new Error("Submission content is too long.");
  }

  const { question } = parseQuestionSolution(content);
  if (!question) {
    throw new Error("Submission has no question text.");
  }
  if (question.length > MAX_CONTENT_CHARS) {
    throw new Error("Question text is too long to generate an answer.");
  }

  const user =
    `Submission type: ${type}\n` +
    "Generate the best answer for this problem:\n\n" +
    question;

  const raw = await callLLM(
    [{ role: "system", content: ANSWER_SYSTEM_PROMPT }, { role: "user", content: user }],
    { model: ANSWER_MODEL, temperature: 0.2 }
  );

  let parsed;
  try {
    parsed = parseJSONResponse(raw);
  } catch (e) {
    throw new Error(`Could not parse model output as JSON: ${e?.message || e}`);
  }

  const solution =
    parsed && typeof parsed === "object" && parsed.solution != null
      ? String(parsed.solution).trim()
      : "";
  if (!solution) {
    throw new Error("Model returned empty solution.");
  }

  const out = JSON.stringify({ question, solution });
  assertMergeContentValidForSubmissionType(type, out);
  if (out.length > MAX_CONTENT_CHARS) {
    throw new Error("Generated answer exceeds maximum length.");
  }
  return out;
}
