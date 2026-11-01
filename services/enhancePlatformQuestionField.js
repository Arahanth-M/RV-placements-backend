import { callLLM } from "./llmClient.js";
import { parseJSONResponse } from "../utils/parseJSONResponse.js";
import { GROQ_KEY_SLOTS } from "../config/groqApiKey.js";
import { getLlmBudget } from "./platformLlmBudgets.js";
import { normalizeMultilineText, compactSingleLine } from "../utils/normalizeMultilineText.js";
import { normalizeSolutionText } from "../utils/normalizeSolutionText.js";
import { updatePlatformQuestion } from "./platformCompanyMutationsService.js";
import CompanyStatic from "../models/CompanyStatic.js";
import CompanyPlatformContent from "../models/CompanyPlatformContent.js";
import mongoose from "mongoose";

export const PLATFORM_ENHANCE_FIELDS = Object.freeze([
  "question",
  "intuition",
  "explanation",
  "cpp",
  "java",
  "python",
]);

const LANG_LABELS = Object.freeze({
  cpp: "C++",
  java: "Java",
  python: "Python",
});

function compact(value, max = 0) {
  const text = compactSingleLine(value);
  if (!max || text.length <= max) return text;
  return text.slice(0, max).trim();
}

function asObjectId(value) {
  try {
    return new mongoose.Types.ObjectId(String(value));
  } catch {
    return null;
  }
}

function parseUiIndex(raw) {
  const index = parseInt(String(raw), 10);
  if (Number.isNaN(index) || index < 0) {
    const err = new Error("Invalid index");
    err.status = 400;
    throw err;
  }
  return index;
}

function approvedWithQuestion(items) {
  const refs = [];
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (item?.status && item.status !== "approved") continue;
    if (!String(item?.question || "").trim()) continue;
    refs.push({ arrayIndex: i, item });
  }
  return refs;
}

function jsonSchema(name, properties) {
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

async function loadQuestionItem(companyId, contentField, uiIndex) {
  if (!["onlineQuestions", "interviewQuestions"].includes(contentField)) {
    const err = new Error("Invalid question field");
    err.status = 400;
    throw err;
  }
  const oid = asObjectId(companyId);
  if (!oid) {
    const err = new Error("Invalid company id");
    err.status = 400;
    throw err;
  }
  const company = await CompanyStatic.findById(oid).select({ name: 1 }).lean();
  if (!company) {
    const err = new Error("Company not found");
    err.status = 404;
    throw err;
  }
  const doc = await CompanyPlatformContent.findOne({ companyId: oid }).lean();
  if (!doc) {
    const err = new Error("Question not found");
    err.status = 404;
    throw err;
  }
  const refs = approvedWithQuestion(doc[contentField]);
  const hit = refs[parseUiIndex(uiIndex)];
  if (!hit) {
    const err = new Error("Question not found");
    err.status = 404;
    throw err;
  }
  return {
    companyId: String(oid),
    companyName: String(company.name || "").trim(),
    contentField,
    uiIndex: parseUiIndex(uiIndex),
    item: hit.item,
  };
}

async function enhanceQuestionText({ companyName, item }) {
  const previous = compact(item?.question, 2500);
  if (!previous) {
    const err = new Error("Question text is empty.");
    err.status = 400;
    throw err;
  }
  const parsed = await requestParsed(
    [
      {
        role: "system",
        content: [
          "You rewrite incomplete placement-prep interview questions into complete question statements.",
          'Return only JSON: {"question":"..."}',
          "Keep the same problem. Do not invent a different question.",
          "If the text is already complete, improve clarity only.",
          "Keep under 1500 characters.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Company: ${companyName || "Unknown"}`,
          `Current question:\n${previous}`,
          "Rewrite into a complete interview question a candidate would actually be asked.",
        ].join("\n\n"),
      },
    ],
    {
      apiKeySlot: GROQ_KEY_SLOTS.ADMIN,
      temperature: 0.2,
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: await getLlmBudget("enhance"),
      response_format: jsonSchema("enhanced_question", {
        question: { type: "string" },
      }),
    }
  );
  const next = normalizeMultilineText(parsed?.question);
  if (!next) {
    const err = new Error("Enhancement returned an empty question.");
    err.status = 500;
    err.code = "enhance_failed";
    throw err;
  }
  return { question: next };
}

async function enhanceIntuition({ companyName, item }) {
  const question = compact(item?.question, 2500);
  const previous = compact(item?.intuition, 2000);
  const parsed = await requestParsed(
    [
      {
        role: "system",
        content: [
          "You write a short interview intuition / approach insight for placement prep.",
          'Return only JSON: {"intuition":"..."}',
          "Use Markdown lightly. Keep under 1200 characters.",
          "Do not write full code.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Company: ${companyName || "Unknown"}`,
          `Question:\n${question}`,
          previous ? `Current intuition (rewrite/improve):\n${previous}` : "Write a clear intuition from scratch.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    {
      apiKeySlot: GROQ_KEY_SLOTS.ADMIN,
      temperature: 0.3,
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: await getLlmBudget("answers-text"),
      response_format: jsonSchema("enhanced_intuition", {
        intuition: { type: "string" },
      }),
    }
  );
  const next = normalizeSolutionText(parsed?.intuition);
  if (!next) {
    const err = new Error("Enhancement returned empty intuition.");
    err.status = 500;
    err.code = "enhance_failed";
    throw err;
  }
  return { intuition: next };
}

async function enhanceExplanation({ companyName, item }) {
  const question = compact(item?.question, 2500);
  const previous = compact(item?.answer, 2500);
  const kind = String(item?.kind || "").trim();
  const parsed = await requestParsed(
    [
      {
        role: "system",
        content: [
          "You write a clear placement-prep explanation / model answer.",
          'Return only JSON: {"explanation":"..."}',
          "Use Markdown. Escape newlines as \\n.",
          kind === "coding"
            ? "Describe approach, complexity, and edge cases. Do not write full source code."
            : "Give a structured factual answer under 2000 characters.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Company: ${companyName || "Unknown"}`,
          `Question:\n${question}`,
          previous
            ? `Current explanation (rewrite/improve):\n${previous}`
            : "Write a complete explanation from scratch.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    {
      apiKeySlot: GROQ_KEY_SLOTS.ADMIN,
      temperature: 0.3,
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: await getLlmBudget("answers-text"),
      response_format: jsonSchema("enhanced_explanation", {
        explanation: { type: "string" },
      }),
    }
  );
  const next = normalizeSolutionText(parsed?.explanation);
  if (!next) {
    const err = new Error("Enhancement returned empty explanation.");
    err.status = 500;
    err.code = "enhance_failed";
    throw err;
  }
  return { explanation: next };
}

async function refillLanguage({ companyName, item, language }) {
  const question = compact(item?.question, 2500);
  const label = LANG_LABELS[language];
  const previous = compact(item?.solutions?.[language], 2000);
  const parsed = await requestParsed(
    [
      {
        role: "system",
        content: [
          `You write one ${label} interview solution for placement prep.`,
          `Return only JSON: {"code":"full ${label} code"}`,
          "The code must be complete. Escape newlines inside the JSON string as \\n.",
          "Never return minified one-line code; indent with 2 or 4 spaces per block.",
          "Use the standard library only unless the problem requires otherwise.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Company: ${companyName || "Unknown"}`,
          `Question:\n${question}`,
          previous
            ? `Rewrite only the ${label} solution. Previous ${label} code:\n${previous}`
            : `Write a complete ${label} solution from scratch.`,
          `Return complete, correctly indented ${label}.`,
        ].join("\n\n"),
      },
    ],
    {
      apiKeySlot: GROQ_KEY_SLOTS.ADMIN,
      temperature: 0.25,
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: await getLlmBudget("answers-coding"),
      response_format: jsonSchema("refilled_code", {
        code: { type: "string" },
      }),
    }
  );
  const code = normalizeMultilineText(parsed?.code);
  if (!code) {
    const err = new Error(`Refill returned empty ${label} code.`);
    err.status = 500;
    err.code = "enhance_failed";
    throw err;
  }
  return {
    solutions: {
      [language]: code,
    },
  };
}

/**
 * Enhance or refill one field on a published platform OA/interview question, then persist.
 * @param {{
 *   companyId: string,
 *   contentField: "onlineQuestions" | "interviewQuestions",
 *   index: number|string,
 *   field: string,
 * }} input
 */
export async function enhancePlatformQuestionField(input = {}) {
  const field = String(input.field || "").trim().toLowerCase();
  if (!PLATFORM_ENHANCE_FIELDS.includes(field)) {
    const err = new Error(
      "field must be one of: question, intuition, explanation, cpp, java, python"
    );
    err.status = 400;
    throw err;
  }

  const loaded = await loadQuestionItem(input.companyId, input.contentField, input.index);
  let patch;
  if (field === "question") {
    patch = await enhanceQuestionText(loaded);
  } else if (field === "intuition") {
    patch = await enhanceIntuition(loaded);
  } else if (field === "explanation") {
    patch = await enhanceExplanation(loaded);
  } else {
    patch = await refillLanguage({
      companyName: loaded.companyName,
      item: loaded.item,
      language: field,
    });
  }

  await updatePlatformQuestion(loaded.companyId, loaded.contentField, loaded.uiIndex, patch);
  return {
    companyId: loaded.companyId,
    contentField: loaded.contentField,
    index: loaded.uiIndex,
    field,
    patch,
    message: `${field} updated`,
  };
}
