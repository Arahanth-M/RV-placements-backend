import { callLLM } from "./llmClient.js";
import { parseJSONResponse } from "../utils/parseJSONResponse.js";

const MAX_CONTENT_CHARS = 70000;
const ENHANCE_MODEL =
  typeof process.env.GROQ_SUBMISSION_ENHANCE_MODEL === "string" &&
  process.env.GROQ_SUBMISSION_ENHANCE_MODEL.trim()
    ? process.env.GROQ_SUBMISSION_ENHANCE_MODEL.trim()
    : "llama-3.1-8b-instant";

function parseLikeApprove(contentStr) {
  try {
    return JSON.parse(contentStr);
  } catch {
    return { question: String(contentStr || ""), solution: "" };
  }
}

/**
 * Ensures mergeContent from client is safe to run through the same approve logic as submission.content.
 * Throws Error with message suitable for 400 responses.
 */
export function assertMergeContentValidForSubmissionType(type, mergeContentStr) {
  if (typeof mergeContentStr !== "string" || !mergeContentStr.trim()) {
    throw new Error("mergeContent must be a non-empty string.");
  }
  if (mergeContentStr.length > MAX_CONTENT_CHARS) {
    throw new Error(`mergeContent exceeds ${MAX_CONTENT_CHARS} characters.`);
  }

  const parsed = parseLikeApprove(mergeContentStr);
  const main = (() => {
    if (type === "onlineQuestions" || type === "interviewQuestions") {
      const q = parsed.question != null ? String(parsed.question).trim() : "";
      return q;
    }
    if (type === "interviewProcess") {
      const t =
        (parsed.question != null ? String(parsed.question).trim() : "") ||
        (parsed.content != null ? String(parsed.content).trim() : "");
      return t;
    }
    if (type === "internshipExperience") {
      const t =
        (parsed.experience != null ? String(parsed.experience).trim() : "") ||
        (parsed.content != null ? String(parsed.content).trim() : "");
      return t;
    }
    if (type === "mustDoTopics") {
      const t =
        (parsed.topic != null ? String(parsed.topic).trim() : "") ||
        (parsed.question != null ? String(parsed.question).trim() : "") ||
        (parsed.content != null ? String(parsed.content).trim() : "");
      return t;
    }
    throw new Error(`Unsupported submission type for merge: ${type}`);
  })();

  if (!main) {
    throw new Error("mergeContent does not contain usable text for this submission type.");
  }
}

function serializeForType(type, obj) {
  if (type === "onlineQuestions" || type === "interviewQuestions") {
    const question = String(obj.question ?? "").trim();
    const solution = obj.solution != null ? String(obj.solution) : "";
    return JSON.stringify({ question, solution });
  }
  if (type === "interviewProcess") {
    const content = String(obj.content ?? obj.question ?? "").trim();
    return JSON.stringify({ content });
  }
  if (type === "mustDoTopics") {
    const topic =
      String(obj.topic ?? obj.content ?? obj.question ?? "")
        .trim() || String(obj.question ?? "").trim();
    return JSON.stringify({ topic });
  }
  if (type === "internshipExperience") {
    const experience =
      String(obj.experience ?? obj.content ?? "")
        .trim() || String(obj.content ?? "").trim();
    return JSON.stringify({ experience });
  }
  throw new Error(`Unsupported submission type: ${type}`);
}

function buildPromptPayload(type, contentStr) {
  const p = parseLikeApprove(contentStr);
  if (type === "onlineQuestions" || type === "interviewQuestions") {
    return {
      question: String(p.question ?? "").trim(),
      solution: p.solution != null ? String(p.solution) : "",
    };
  }
  if (type === "interviewProcess") {
    const text = String(p.content ?? p.question ?? "").trim();
    return { content: text };
  }
  if (type === "mustDoTopics") {
    const text =
      String(p.topic ?? p.question ?? p.content ?? "")
        .trim() || String(p.content ?? "").trim();
    return { topic: text };
  }
  if (type === "internshipExperience") {
    const text =
      String(p.experience ?? p.content ?? "")
        .trim() || String(p.content ?? "").trim();
    return { experience: text };
  }
  throw new Error(`Unsupported submission type: ${type}`);
}

function systemPromptForType(type) {
  const base =
    "You polish student-written placement-prep content for a college app. " +
    "Improve clarity, grammar, and structure only; keep technical meaning and facts. " +
    "Do not invent company-specific facts. " +
    "Reply with a single JSON object only (no markdown fences, no commentary). ";

  if (type === "onlineQuestions" || type === "interviewQuestions") {
    return (
      base +
      'Schema: {"question": string, "solution": string}. ' +
      "Both fields required; use empty string for solution if none."
    );
  }
  if (type === "interviewProcess") {
    return base + 'Schema: {"content": string} — one narrative of the interview process.';
  }
  if (type === "mustDoTopics") {
    return base + 'Schema: {"topic": string} — one concise must-do topic line.';
  }
  if (type === "internshipExperience") {
    return base + 'Schema: {"experience": string} — internship experience write-up.';
  }
  return base;
}

function normalizeLlmObject(type, raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Model returned invalid JSON (not an object).");
  }
  if (type === "onlineQuestions" || type === "interviewQuestions") {
    const question = String(raw.question ?? "").trim();
    const solution = raw.solution != null ? String(raw.solution) : "";
    if (!question) throw new Error("Enhanced output missing question text.");
    return { question, solution };
  }
  if (type === "interviewProcess") {
    const content = String(raw.content ?? raw.question ?? "").trim();
    if (!content) throw new Error("Enhanced output missing content.");
    return { content };
  }
  if (type === "mustDoTopics") {
    const topic = String(raw.topic ?? raw.content ?? raw.question ?? "").trim();
    if (!topic) throw new Error("Enhanced output missing topic.");
    return { topic };
  }
  if (type === "internshipExperience") {
    const experience = String(raw.experience ?? raw.content ?? "").trim();
    if (!experience) throw new Error("Enhanced output missing experience text.");
    return { experience };
  }
  throw new Error(`Unsupported submission type: ${type}`);
}

/**
 * One-click AI polish. Does not persist. Returns content string in the same shape approve() expects.
 */
export async function enhanceSubmissionContent({ type, content }) {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Submission content is empty.");
  }
  if (content.length > MAX_CONTENT_CHARS) {
    throw new Error("Submission content is too long to enhance.");
  }

  const payload = buildPromptPayload(type, content);
  const payloadJson = JSON.stringify(payload);
  if (payloadJson.length > MAX_CONTENT_CHARS) {
    throw new Error("Payload too large for enhancement.");
  }

  const system = systemPromptForType(type);
  const user =
    `Submission type: ${type}\n` +
    `Input JSON (improve these fields in-place semantically, same keys):\n${payloadJson}`;

  const raw = await callLLM(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { model: ENHANCE_MODEL }
  );

  let parsed;
  try {
    parsed = parseJSONResponse(raw);
  } catch (e) {
    throw new Error(`Could not parse model output as JSON: ${e?.message || e}`);
  }

  const normalized = normalizeLlmObject(type, parsed);
  const out = serializeForType(type, normalized);
  assertMergeContentValidForSubmissionType(type, out);
  if (out.length > MAX_CONTENT_CHARS) {
    throw new Error("Enhanced content exceeds maximum length.");
  }
  return out;
}
