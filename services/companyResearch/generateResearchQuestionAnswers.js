import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";
import { GROQ_KEY_SLOTS } from "../../config/groqApiKey.js";
import { getResearchJob, replaceResearchJobResultItems } from "./researchJobService.js";
import { PublishResearchError, parseSelectedIndexes } from "./publishResearchInterviewQuestions.js";
import { normalizeMultilineText, compactSingleLine } from "../../utils/normalizeMultilineText.js";

function compact(value) {
  return compactSingleLine(value);
}

function assertReviewJob(job) {
  if (!job) throw new PublishResearchError("job_not_found");
  if (job.status === "published") throw new PublishResearchError("already_published");
  if (job.status !== "review") throw new PublishResearchError("not_reviewable");
  if (!Array.isArray(job.result?.items)) throw new PublishResearchError("invalid_selection");
}

const NON_CODING_SYSTEM = [
  "You write concise interview answers for placement prep.",
  'Return only JSON: {"answer":"..."}.',
  "Formatting rules for answer (use real newline characters \\n in the JSON string):",
  "- Use Markdown: **bold** for key terms, numbered lists as '1. **Title** – explanation' one item per line.",
  "- Put a blank line before each numbered list item.",
  "- For SQL/table examples use GitHub-flavored Markdown tables with one row per line and a header separator row.",
  "- Do not run the whole answer as a single paragraph.",
  "Keep the answer factual, structured, and under 2000 characters.",
  "Do not invent company-specific secrets; give a strong generic model answer.",
].join(" ");

const CODING_SYSTEM = [
  "You write interview coding solutions for placement prep.",
  "Return only JSON:",
  '{"answer":"brief approach and complexity","solutions":{"cpp":"full code","java":"full code","python":"full code"}}',
  "Each solution must be complete runnable-style code with real newline characters \\n between statements, includes, and braces.",
  "Never return minified one-line code; indent with 2 or 4 spaces per block.",
  "Use standard library only unless the problem requires otherwise.",
].join(" ");

async function generateOneAnswer(item) {
  const question = compact(item?.question);
  if (!question) {
    throw new PublishResearchError("invalid_selection");
  }
  const kind = item?.kind === "coding" ? "coding" : "non_coding";
  const evidence = compact(item?.evidence);
  const userContent = [
    `Question: ${question}`,
    evidence ? `Context from source: ${evidence}` : "",
    kind === "coding"
      ? "Provide C++, Java, and Python solutions."
      : "Provide a clear written answer.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await callLLM(
    [
      { role: "system", content: kind === "coding" ? CODING_SYSTEM : NON_CODING_SYSTEM },
      { role: "user", content: userContent },
    ],
    { apiKeySlot: GROQ_KEY_SLOTS.ADMIN }
  );

  const parsed = parseJSONResponse(response);
  if (!parsed || typeof parsed !== "object") {
    const error = new Error("Answer generation returned invalid JSON.");
    error.code = "answer_generation_failed";
    throw error;
  }

  if (kind === "coding") {
    const solutions = parsed.solutions && typeof parsed.solutions === "object" ? parsed.solutions : {};
    return {
      answer: normalizeMultilineText(parsed.answer),
      intuition: normalizeMultilineText(parsed.intuition),
      solutions: {
        cpp: normalizeMultilineText(solutions.cpp),
        java: normalizeMultilineText(solutions.java),
        python: normalizeMultilineText(solutions.python),
      },
    };
  }

  return {
    answer: normalizeMultilineText(parsed.answer),
    intuition: normalizeMultilineText(parsed.intuition),
  };
}

/**
 * Generate answers for selected research items and persist them on the Redis job.
 * @param {{ jobId?: string, selectedIndexes?: unknown }} input
 */
export async function generateResearchQuestionAnswers(input = {}) {
  const indexes = parseSelectedIndexes(input.selectedIndexes);
  const jobId = String(input.jobId || "").trim();
  const job = await getResearchJob(jobId);
  assertReviewJob(job);

  for (const index of indexes) {
    if (index >= job.result.items.length) {
      throw new PublishResearchError("invalid_selection");
    }
  }

  const items = job.result.items.map((row) => ({ ...row }));
  const updatedIndexes = [];

  try {
    for (const index of indexes) {
      const generated = await generateOneAnswer(items[index]);
      items[index] = { ...items[index], ...generated };
      updatedIndexes.push(index);
    }
  } catch (error) {
    console.error("[company-research] answer generation failed", {
      jobId,
      code: error?.code || "answer_generation_failed",
    });
    const wrapped = new Error("Answers could not be generated.");
    wrapped.code = "answer_generation_failed";
    wrapped.status = 500;
    throw wrapped;
  }

  await replaceResearchJobResultItems(jobId, items);

  return {
    jobId,
    updatedIndexes,
    items: updatedIndexes.map((index) => ({ index, ...items[index] })),
  };
}
