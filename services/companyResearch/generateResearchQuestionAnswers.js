import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";
import { GROQ_KEY_SLOTS } from "../../config/groqApiKey.js";
import { getLlmBudget } from "../platformLlmBudgets.js";
import { llmActionError } from "../../utils/publicProviderError.js";
import { getResearchJob, replaceResearchJobResultItems } from "./researchJobService.js";
import { PublishResearchError, parseSelectedIndexes } from "./publishResearchInterviewQuestions.js";
import { normalizeMultilineText, compactSingleLine } from "../../utils/normalizeMultilineText.js";

const MAX_QUESTION_CHARS = 6000;
const MAX_EVIDENCE_CHARS = 1200;

function compact(value, max = 0) {
  const text = compactSingleLine(value);
  if (!max || text.length <= max) return text;
  return text.slice(0, max).trim();
}

function assertReviewJob(job) {
  if (!job) throw new PublishResearchError("job_not_found");
  if (job.status === "published") throw new PublishResearchError("already_published");
  if (job.status !== "review") throw new PublishResearchError("not_reviewable");
  if (job.field === "interviewExperiences") throw new PublishResearchError("not_reviewable");
  if (!Array.isArray(job.result?.items)) throw new PublishResearchError("invalid_selection");
}

const NON_CODING_SYSTEM = [
  "You write concise interview answers for placement prep.",
  'Return only JSON: {"answer":"..."}.',
  "Formatting rules for the answer string: escape newlines as \\n. Do not put raw line breaks inside the JSON.",
  "- Use Markdown: **bold** for key terms, numbered lists as '1. **Title** – explanation' one item per line.",
  "- Put a blank line before each numbered list item, encoded as \\n\\n.",
  "- For SQL/table examples use GitHub-flavored Markdown tables with one row per line and a header separator row.",
  "- Do not run the whole answer as a single paragraph.",
  "Keep the answer factual, structured, and under 2000 characters.",
  "Do not invent company-specific secrets; give a strong generic model answer.",
].join(" ");

const CODING_LANGUAGES = Object.freeze({
  cpp: "C++",
  java: "Java",
  python: "Python",
});

const CODING_LANGUAGE_ORDER = Object.freeze(["cpp", "java", "python"]);

function strictObjectSchema(name, properties) {
  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties,
        required: Object.keys(properties),
      },
    },
  };
}

const WRITTEN_ANSWER_FORMAT = strictObjectSchema("written_answer", {
  answer: { type: "string" },
});

const MCQ_ANSWER_FORMAT = strictObjectSchema("mcq_answer", {
  answer: { type: "string" },
  explanation: { type: "string" },
});

const SOURCE_CODE_FORMAT = strictObjectSchema("source_code", {
  code: { type: "string" },
});

const APPROACH_SYSTEM = [
  "You write a brief coding-interview approach for placement prep.",
  'Return only JSON: {"answer":"approach, edge cases, and time/space complexity"}.',
  "Do not include source code.",
  "Keep the answer under 800 characters.",
  "Escape newlines inside the JSON string as \\n. Do not put raw line breaks inside the JSON.",
].join(" ");

const SQL_SYSTEM = [
  "You write SQL solutions for online assessment prep.",
  'Return only JSON: {"answer":"SQL query and brief explanation"}',
  "Use standard SQL. Explain assumptions in the answer field.",
].join(" ");

const MCQ_SYSTEM = [
  "You explain multiple-choice OA questions for placement prep.",
  'Return only JSON: {"answer":"why the correct option is right","explanation":"short teaching note"}',
  "If options are provided, reference the correct letter.",
].join(" ");

function parseRegenerateLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  if (!language) return "";
  if (!Object.prototype.hasOwnProperty.call(CODING_LANGUAGES, language)) {
    throw new PublishResearchError("invalid_selection");
  }
  return language;
}

function oaFormOf(item) {
  const form = String(item?.form || "").trim().toLowerCase();
  if (form === "coding" || form === "sql" || form === "mcq") return form;
  if (item?.kind === "coding") return "coding";
  if (item?.kind === "sql") return "sql";
  return "non_coding";
}

async function answerCallOptions(form, regenerate = false, responseFormat = WRITTEN_ANSWER_FORMAT) {
  const max_completion_tokens = await getLlmBudget(form === "coding" ? "answers-coding" : "answers-text");
  return {
    apiKeySlot: GROQ_KEY_SLOTS.ADMIN,
    temperature: regenerate ? 0.4 : 0.1,
    reasoning_effort: "low",
    include_reasoning: false,
    max_completion_tokens,
    response_format: responseFormat,
  };
}

function userPrompt(question, evidence, extra) {
  return [`Question: ${question}`, evidence ? `Context from source: ${evidence}` : "", extra]
    .filter(Boolean)
    .join("\n\n");
}

async function requestParsed(messages, callOptions) {
  let response = await callLLM(messages, callOptions);
  try {
    return parseJSONResponse(response);
  } catch (error) {
    response = await callLLM(
      [
        ...messages,
        {
          role: "user",
          content: "Return one JSON object only. Escape newlines inside strings as \\n.",
        },
      ],
      callOptions
    );
    const parsed = parseJSONResponse(response);
    if (!parsed) throw error;
    return parsed;
  }
}

function assertParsedObject(parsed) {
  if (!parsed || typeof parsed !== "object") {
    const error = new Error("Answer generation returned invalid JSON.");
    error.code = "answer_generation_failed";
    throw error;
  }
}

function previousAnswerText(item) {
  const parts = [];
  const answer = compact(item?.answer, 800);
  if (answer) parts.push(answer);
  const solutions = item?.solutions && typeof item.solutions === "object" ? item.solutions : null;
  if (solutions) {
    for (const language of ["cpp", "java", "python"]) {
      const code = compact(solutions[language], 500);
      if (code) parts.push(`${language}: ${code}`);
    }
  }
  return parts.join("\n").slice(0, 1500);
}

function languageSolutionMessages(item, language, { regenerate, question, evidence }) {
  const label = CODING_LANGUAGES[language];
  const system = [
    `You write one ${label} interview solution for placement prep.`,
    `Return only JSON: {"code":"full ${label} code"}`,
    "The code must be complete. Escape newlines inside the JSON string as \\n. Do not put raw line breaks inside the JSON.",
    "Never return minified one-line code; indent with 2 or 4 spaces per block.",
    "Use the standard library only unless the problem requires otherwise.",
    "Do not return any other language.",
  ].join(" ");
  const previousCode = regenerate ? compact(item?.solutions?.[language], 800) : "";
  let extra = previousCode
    ? `Rewrite only the ${label} solution. The previous ${label} code was inaccurate or poorly formatted:\n${previousCode}`
    : `Write a complete ${label} solution.`;
  extra += `\nReturn complete, correctly indented ${label}. Do not minify or leave the code incomplete.`;
  return [
    { role: "system", content: system },
    { role: "user", content: userPrompt(question, evidence, extra) },
  ];
}

async function generateLanguageSolution(item, language, context) {
  const callOptions = await answerCallOptions("coding", context.regenerate, SOURCE_CODE_FORMAT);
  const parsed = await requestParsed(languageSolutionMessages(item, language, context), callOptions);
  assertParsedObject(parsed);
  const solutions = parsed.solutions && typeof parsed.solutions === "object" ? parsed.solutions : {};
  return normalizeMultilineText(parsed.code || solutions[language]);
}

async function generateAllCodingSolutions(item, context) {
  const { regenerate, question, evidence } = context;
  let extra = "Describe the approach, edge cases, and time/space complexity. Do not write code.";
  if (regenerate) {
    const previous = compact(item?.answer, 800);
    extra += previous
      ? `\n\nRewrite the previous approach. It was inaccurate or poorly formatted:\n${previous}`
      : "\n\nRewrite a cleaner and more accurate approach.";
  }
  const approach = await requestParsed(
    [
      { role: "system", content: APPROACH_SYSTEM },
      { role: "user", content: userPrompt(question, evidence, extra) },
    ],
    await answerCallOptions("text", regenerate, WRITTEN_ANSWER_FORMAT)
  );
  assertParsedObject(approach);

  const codes = [];
  for (const language of CODING_LANGUAGE_ORDER) {
    codes.push(await generateLanguageSolution(item, language, context));
  }

  return {
    answer: normalizeMultilineText(approach.answer),
    intuition: normalizeMultilineText(approach.intuition),
    solutions: {
      cpp: codes[0] || "",
      java: codes[1] || "",
      python: codes[2] || "",
    },
  };
}

async function generateOneAnswer(item, { regenerate = false, language = "" } = {}) {
  const question = compact(item?.question, MAX_QUESTION_CHARS);
  if (!question) {
    throw new PublishResearchError("invalid_selection");
  }
  const form = oaFormOf(item);
  const evidence = compact(item?.evidence, MAX_EVIDENCE_CHARS);
  const context = { regenerate, question, evidence };

  if (form === "coding" && language) {
    const code = await generateLanguageSolution(item, language, context);
    return { solutions: { [language]: code } };
  }

  if (form === "coding") {
    return generateAllCodingSolutions(item, context);
  }

  const meta = item?.mcqMetadata && typeof item.mcqMetadata === "object" ? item.mcqMetadata : null;
  const optionLines =
    meta && Array.isArray(meta.options)
      ? meta.options.map((opt) => `${opt.id}. ${opt.text}`).join("\n")
      : "";

  let system = NON_CODING_SYSTEM;
  let extra = "Provide a clear written answer.";
  let responseFormat = WRITTEN_ANSWER_FORMAT;
  if (form === "sql") {
    system = SQL_SYSTEM;
    extra = "Provide SQL and a short explanation.";
  } else if (form === "mcq") {
    system = MCQ_SYSTEM;
    responseFormat = MCQ_ANSWER_FORMAT;
    extra = optionLines
      ? `Options:\n${optionLines}\nCorrect option id: ${meta?.correctOptionId || "unknown"}`
      : "Provide the best answer explanation.";
  }
  if (regenerate) {
    const previous = previousAnswerText(item);
    extra += previous
      ? `\n\nRewrite the previous answer. It was inaccurate or poorly formatted:\n${previous}`
      : "\n\nRewrite a cleaner and more accurate answer.";
    if (form === "sql") {
      extra +=
        "\nIf you show a result table, use a Markdown table with a header row, a separator row, and one data row per line.";
    }
  }

  const parsed = await requestParsed(
    [
      { role: "system", content: system },
      { role: "user", content: userPrompt(question, evidence, extra) },
    ],
    await answerCallOptions(form, regenerate, responseFormat)
  );
  assertParsedObject(parsed);

  const answer = normalizeMultilineText(parsed.answer);
  const explanation = normalizeMultilineText(parsed.explanation);
  if (form === "mcq" && meta) {
    return {
      answer,
      intuition: explanation,
      mcqMetadata: {
        ...meta,
        explanation: explanation || meta.explanation || answer,
      },
    };
  }

  return {
    answer,
    intuition: explanation || normalizeMultilineText(parsed.intuition),
  };
}

/**
 * Generate answers for selected research items and persist them on the Redis job.
 * @param {{ jobId?: string, selectedIndexes?: unknown, regenerate?: boolean, language?: string }} input
 */
export async function generateResearchQuestionAnswers(input = {}) {
  const indexes = parseSelectedIndexes(input.selectedIndexes);
  const regenerate = input.regenerate === true;
  const language = regenerate ? parseRegenerateLanguage(input.language) : "";
  const jobId = String(input.jobId || "").trim();
  const job = await getResearchJob(jobId);
  assertReviewJob(job);

  for (const index of indexes) {
    if (index >= job.result.items.length) {
      throw new PublishResearchError("invalid_selection");
    }
    if (language && oaFormOf(job.result.items[index]) !== "coding") {
      throw new PublishResearchError("invalid_selection");
    }
  }

  const sourceItems = job.result.items.map((row) => ({ ...row }));
  const updatedIndexes = [];
  /** @type {Map<number, object>} */
  const generatedByIndex = new Map();

  try {
    for (const index of indexes) {
      const generated = await generateOneAnswer(sourceItems[index], { regenerate, language });
      generatedByIndex.set(index, generated);
      updatedIndexes.push(index);
    }
  } catch (error) {
    if (error?.name === "PublishResearchError") throw error;
    console.error("[company-research] answer generation failed", {
      jobId,
      code: error?.code || "answer_generation_failed",
      message: String(error?.message || "").slice(0, 300),
    });
    throw llmActionError(
      error,
      "answer_generation_failed",
      "Answers could not be generated.",
      "groq-admin"
    );
  }

  const latest = await getResearchJob(jobId);
  assertReviewJob(latest);
  const items = latest.result.items.map((row) => ({ ...row }));
  for (const index of updatedIndexes) {
    if (index >= items.length) continue;
    const generated = generatedByIndex.get(index) || {};
    if (language && generated.solutions) {
      const previous =
        items[index].solutions && typeof items[index].solutions === "object" ? items[index].solutions : {};
      items[index] = {
        ...items[index],
        solutions: {
          ...previous,
          [language]: generated.solutions[language] || "",
        },
      };
    } else {
      items[index] = { ...items[index], ...generated };
    }
  }
  await replaceResearchJobResultItems(jobId, items);

  return {
    jobId,
    updatedIndexes,
    items: updatedIndexes.map((index) => ({ index, ...items[index] })),
  };
}
