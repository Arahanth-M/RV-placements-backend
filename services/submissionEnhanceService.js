import { callLLM } from "./llmClient.js";
import { parseJSONResponse } from "../utils/parseJSONResponse.js";
import { GROQ_QUALITY_MODEL } from "../config/groqModels.js";

const MAX_CONTENT_CHARS = 70000;
const ENHANCE_MODEL =
  typeof process.env.GROQ_SUBMISSION_ENHANCE_MODEL === "string" &&
  process.env.GROQ_SUBMISSION_ENHANCE_MODEL.trim()
    ? process.env.GROQ_SUBMISSION_ENHANCE_MODEL.trim()
    : GROQ_QUALITY_MODEL;

/** Submission types that support AI polish before approve. */
export function isSubmissionEnhancementSupported(type) {
  return type !== "mustDoTopics";
}

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
  if (!isSubmissionEnhancementSupported(type)) {
    throw new Error("AI enhancement is not available for must-do topic submissions.");
  }
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
  if (type === "internshipExperience") {
    const text =
      String(p.experience ?? p.content ?? "")
        .trim() || String(p.content ?? "").trim();
    return { experience: text };
  }
  throw new Error(`Unsupported submission type: ${type}`);
}

const MEANING_PRESERVATION_RULES =
  "You are a conservative copy-editor for student placement-prep submissions. " +
  "Your job is ONLY to fix spelling, grammar, punctuation, and awkward phrasing. " +
  "CRITICAL — preserve meaning exactly: do NOT change facts, steps, requirements, constraints, " +
  "difficulty claims, round names, technologies, numbers, dates, company names, or the author's intent. " +
  "Do NOT add, remove, reorder, summarize, or expand ideas. Do NOT paraphrase in a way that changes meaning. " +
  "Do NOT invent or infer information that is not in the input. " +
  "If a sentence is unclear but grammatical, leave its meaning unchanged (at most fix typos). " +
  "Reply with a single JSON object only (no markdown fences, no commentary). ";

function systemPromptForType(type) {
  if (type === "onlineQuestions" || type === "interviewQuestions") {
    return (
      MEANING_PRESERVATION_RULES +
      'Schema: {"question": string, "solution": string}. Both fields required; use empty string for solution if none. ' +
      "For question: copy-edit the problem statement only — keep the same problem, same constraints, same examples. " +
      "For solution: fix grammar in prose only; preserve all code, logic, variable names, complexity, and algorithm steps exactly " +
      "(only fix obvious typos in identifiers or comments if clearly misspelled)."
    );
  }
  if (type === "interviewProcess") {
    return (
      MEANING_PRESERVATION_RULES +
      'Schema: {"content": string}. Copy-edit the interview-process narrative only; keep the same rounds, order, and details.'
    );
  }
  if (type === "internshipExperience") {
    return (
      MEANING_PRESERVATION_RULES +
      'Schema: {"experience": string}. Copy-edit the internship write-up only; keep the same events and claims.'
    );
  }
  return MEANING_PRESERVATION_RULES;
}

function userPromptForEnhancement(type, payloadJson) {
  return (
    `Submission type: ${type}\n` +
    "Task: Return the SAME JSON keys and values, with copy-edits only (spelling/grammar/punctuation). " +
    "The reviewer must recognize this as the same submission — meaning unchanged.\n" +
    `Input JSON:\n${payloadJson}`
  );
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
  if (!isSubmissionEnhancementSupported(type)) {
    throw new Error("AI enhancement is not available for must-do topic submissions.");
  }
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
  const user = userPromptForEnhancement(type, payloadJson);

  const raw = await callLLM(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { model: ENHANCE_MODEL, temperature: 0 }
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
