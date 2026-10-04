import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";
import { GROQ_KEY_SLOTS } from "../../config/groqApiKey.js";
import { getResearchJob, replaceResearchJobResultItems } from "./researchJobService.js";
import { PublishResearchError, parseSelectedIndexes } from "./publishResearchInterviewQuestions.js";
import { normalizeMultilineText } from "../../utils/normalizeMultilineText.js";

const BATCH_SIZE = 6;
const MAX_QUESTION_CHARS = 4000;
const MAX_EVIDENCE_CHARS = 700;

const SYSTEM = [
  "You turn incomplete placement-prep questions into complete question statements.",
  "The input is often a single word or a problem title scraped from the web, such as \"LRU Cache\" or \"Deadlock\".",
  "For each item, write the full question a candidate would actually be asked.",
  "A coding title must become the full problem statement: what to implement, the inputs, the outputs, and the usual constraints for that problem.",
  "A topic word must become a complete interview question about that topic.",
  "If the text is already a full question, keep the same question and only complete missing wording.",
  "Do not replace a question with a different problem.",
  "Use evidence only as context. Do not paste the source. Do not invent company-private information.",
  "Each question must be under 1500 characters.",
  'Return only JSON: {"items":[{"index":0,"question":"complete question"}]}',
  "Include every input index exactly once.",
].join(" ");

function assertReviewQuestions(job) {
  if (!job) throw new PublishResearchError("job_not_found");
  if (job.status === "published") throw new PublishResearchError("already_published");
  if (job.status !== "review") throw new PublishResearchError("not_reviewable");
  if (job.field === "interviewExperiences") throw new PublishResearchError("not_reviewable");
  if (!Array.isArray(job.result?.items)) throw new PublishResearchError("invalid_selection");
}

function clip(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).trim();
}

function batchPrompt(job, batch) {
  const lines = [
    `Company: ${clip(job.companyName, 120) || "Unknown"}`,
    `Role: ${clip(job.role, 80) || "General"}`,
    "Items:",
  ];
  for (const row of batch) {
    const item = row.item;
    lines.push(
      [
        `${row.index}. kind=${clip(item?.kind || item?.form, 40) || "question"}`,
        `fragment: ${clip(item?.question, 500)}`,
        item?.evidence ? `evidence: ${clip(item.evidence, MAX_EVIDENCE_CHARS)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return lines.join("\n\n");
}

function enhancedQuestion(raw) {
  const question = normalizeMultilineText(raw).replace(/\n{3,}/g, "\n\n");
  if (!question || question.length > MAX_QUESTION_CHARS) return "";
  return question;
}

async function enhanceBatch(job, batch) {
  const response = await callLLM(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: batchPrompt(job, batch) },
    ],
    { apiKeySlot: GROQ_KEY_SLOTS.ADMIN }
  );
  const parsed = parseJSONResponse(response);
  const rows = Array.isArray(parsed?.items) ? parsed.items : [];
  const byIndex = new Map();
  for (const row of rows) {
    const index = row?.index;
    const question = enhancedQuestion(row?.question);
    if (!Number.isInteger(index) || !question) continue;
    byIndex.set(index, question);
  }
  return byIndex;
}

/**
 * Expand selected research fragments into full question statements and save them on the job.
 * @param {{ jobId?: string, selectedIndexes?: unknown }} input
 */
export async function enhanceResearchQuestions(input = {}) {
  const indexes = parseSelectedIndexes(input.selectedIndexes);
  const jobId = String(input.jobId || "").trim();
  const job = await getResearchJob(jobId);
  assertReviewQuestions(job);

  for (const index of indexes) {
    if (index >= job.result.items.length) {
      throw new PublishResearchError("invalid_selection");
    }
  }

  const items = job.result.items.map((row) => ({ ...row }));
  const updatedIndexes = [];

  try {
    for (let start = 0; start < indexes.length; start += BATCH_SIZE) {
      const batch = indexes.slice(start, start + BATCH_SIZE).map((index) => ({
        index,
        item: items[index],
      }));
      const enhanced = await enhanceBatch(job, batch);
      for (const index of batch.map((row) => row.index)) {
        const next = enhanced.get(index);
        const current = String(items[index]?.question || "").trim();
        if (!next || next === current) continue;
        const sourceQuestion = String(items[index]?.sourceQuestion || current).trim();
        items[index] = {
          ...items[index],
          question: next,
          ...(sourceQuestion && sourceQuestion !== next ? { sourceQuestion } : {}),
        };
        updatedIndexes.push(index);
      }
    }
  } catch (error) {
    console.error("[company-research] question enhance failed", {
      jobId,
      code: error?.code || "enhance_failed",
    });
    const wrapped = new Error("Questions could not be enhanced.");
    wrapped.code = "enhance_failed";
    wrapped.status = 500;
    throw wrapped;
  }

  if (updatedIndexes.length > 0) {
    await replaceResearchJobResultItems(jobId, items);
  }

  return {
    jobId,
    updatedIndexes,
    items: updatedIndexes.map((index) => ({
      index,
      question: items[index].question,
      sourceQuestion: items[index].sourceQuestion || "",
    })),
  };
}
