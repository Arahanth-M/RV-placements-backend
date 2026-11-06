import { spawnSync } from "child_process";
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

/** Keep newlines/indentation for source code (unlike compact()). */
function preserveCode(value, max = 4000) {
  const text = normalizeMultilineText(value);
  if (!max || text.length <= max) return text;
  return text.slice(0, max).trimEnd();
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

/** Strip line/block/hash comments while preserving string and char literals. */
function stripCodeComments(code, language) {
  const src = String(code || "");
  if (!src) return src;

  let out = "";
  let i = 0;
  let mode = "code"; // code | line | block | string
  let quote = "";
  let escape = false;
  const isPython = language === "python";

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (mode === "line") {
      if (ch === "\n") {
        mode = "code";
        out += ch;
      }
      i += 1;
      continue;
    }

    if (mode === "block") {
      if (ch === "*" && next === "/") {
        mode = "code";
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (mode === "string") {
      out += ch;
      if (escape) {
        escape = false;
        i += 1;
        continue;
      }
      if (ch === "\\" && quote.length === 1) {
        escape = true;
        i += 1;
        continue;
      }
      if (quote.length === 3) {
        if (src.startsWith(quote, i)) {
          out += quote.slice(1);
          i += 3;
          mode = "code";
          continue;
        }
        i += 1;
        continue;
      }
      if (ch === quote) {
        mode = "code";
      }
      i += 1;
      continue;
    }

    // mode === "code"
    if (isPython && (ch === '"' || ch === "'")) {
      if (src.startsWith(ch.repeat(3), i)) {
        quote = ch.repeat(3);
        out += quote;
        i += 3;
        mode = "string";
        continue;
      }
      quote = ch;
      out += ch;
      i += 1;
      mode = "string";
      continue;
    }

    if (!isPython && (ch === '"' || ch === "'" || ch === "`")) {
      quote = ch;
      out += ch;
      i += 1;
      mode = "string";
      continue;
    }

    if (!isPython && ch === "/" && next === "/") {
      mode = "line";
      i += 2;
      continue;
    }
    if (!isPython && ch === "/" && next === "*") {
      mode = "block";
      i += 2;
      continue;
    }
    if (isPython && ch === "#") {
      mode = "line";
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripMarkdownFences(code) {
  let text = String(code || "").trim();
  if (!text.startsWith("```")) return text;
  text = text.replace(/^```(?:python|py|Python)?\s*\n?/, "");
  text = text.replace(/\n?```\s*$/, "");
  return text.trim();
}

/** Best-effort docstring removal when python3 is unavailable. */
function stripPythonDocstringsJs(code) {
  return String(code || "")
    .replace(/^[ \t]*("""[\s\S]*?"""|'''[\s\S]*?''')[ \t]*\r?\n?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function python3Available() {
  try {
    const result = spawnSync("python3", ["--version"], {
      encoding: "utf8",
      timeout: 3000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Clean Python solution. Uses ast.unparse when python3 exists; otherwise JS cleanup.
 * @returns {{ code: string|null, error: string|null, usedPython: boolean }}
 */
function finalizePythonSolution(code) {
  const cleaned = stripPythonDocstringsJs(
    stripCodeComments(stripMarkdownFences(normalizeMultilineText(code)), "python")
  );
  if (!cleaned) {
    return { code: null, error: "empty code", usedPython: false };
  }

  if (!python3Available()) {
    // Docker images historically shipped without python3 — never hard-fail for that.
    return { code: cleaned, error: null, usedPython: false };
  }

  const script = [
    "import ast, sys",
    "src = sys.stdin.read()",
    "tree = ast.parse(src)",
    "class StripDocs(ast.NodeTransformer):",
    "    def _strip(self, node):",
    "        self.generic_visit(node)",
    "        if getattr(node, 'body', None) and isinstance(node.body[0], ast.Expr):",
    "            v = node.body[0].value",
    "            if isinstance(v, ast.Constant) and isinstance(v.value, str):",
    "                node.body = node.body[1:] or [ast.Pass()]",
    "        return node",
    "    def visit_Module(self, node):",
    "        return self._strip(node)",
    "    def visit_FunctionDef(self, node):",
    "        return self._strip(node)",
    "    def visit_AsyncFunctionDef(self, node):",
    "        return self._strip(node)",
    "    def visit_ClassDef(self, node):",
    "        return self._strip(node)",
    "tree = StripDocs().visit(tree)",
    "print(ast.unparse(tree))",
  ].join("\n");

  try {
    const result = spawnSync("python3", ["-c", script], {
      input: cleaned,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 8000,
    });
    if (result.status !== 0) {
      const errText = String(result.stderr || result.stdout || "syntax error")
        .split("\n")
        .filter(Boolean)
        .slice(0, 4)
        .join(" | ");
      return { code: null, error: errText || "syntax error", usedPython: true };
    }
    const out = normalizeMultilineText(result.stdout);
    if (!out) {
      return { code: null, error: "empty after unparse", usedPython: true };
    }
    return { code: out, error: null, usedPython: true };
  } catch (error) {
    return {
      code: cleaned,
      error: null,
      usedPython: false,
    };
  }
}

async function generateLanguageCode({
  companyName,
  item,
  language,
  previous,
  repairHint = "",
}) {
  const question = compact(item?.question, 2500);
  const label = LANG_LABELS[language];
  const answerHint = compact(item?.answer, 1500);
  const intuitionHint = compact(item?.intuition, 800);
  const pythonRules =
    language === "python"
      ? [
          "Python formatting is mandatory:",
          "use exactly 4 spaces per indent level;",
          "never put a suite on the same line after a colon;",
          "never put two statements on one line;",
          "elif/else must align with their matching if;",
          "return/result statements must use the correct block indent;",
          "no docstrings.",
        ].join(" ")
      : "Never return minified one-line code; indent with 2 or 4 spaces per block.";

  const parsed = await requestParsed(
    [
      {
        role: "system",
        content: [
          `You write one correct, compilable/runnable ${label} interview solution for placement prep.`,
          `Return only JSON: {"code":"full ${label} code"}`,
          "The solution must be algorithmically correct for the stated problem, handle typical edge cases, and match the intended time/space approach when implied.",
          "Do NOT include any comments: no // lines, no /* */ blocks, no # comments, and no docstrings or explanatory prose inside the code.",
          "Prefer clear names over comments. Output code only.",
          "The code must be complete. Escape newlines inside the JSON string as \\n.",
          pythonRules,
          "Use the standard library only unless the problem requires otherwise.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Company: ${companyName || "Unknown"}`,
          `Question:\n${question}`,
          intuitionHint
            ? `Intuition (follow this approach when consistent with a correct solution):\n${intuitionHint}`
            : null,
          answerHint
            ? `Explanation / expected approach (use for correctness; do not paste as comments):\n${answerHint}`
            : null,
          previous
            ? `Rewrite a complete, correctly indented ${label} solution. Fix logic bugs and indentation. Previous ${label} code (preserve intent, not broken formatting):\n${previous}`
            : `Write a complete, correct ${label} solution from scratch.`,
          repairHint
            ? `Previous attempt was invalid. Fix it. Validator notes:\n${repairHint}`
            : null,
          `Return complete, correctly indented ${label} with zero comments. One statement per line.`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    {
      apiKeySlot: GROQ_KEY_SLOTS.ADMIN,
      temperature: repairHint ? 0.05 : 0.1,
      reasoning_effort: "medium",
      include_reasoning: false,
      max_completion_tokens: await getLlmBudget("answers-coding"),
      response_format: jsonSchema("refilled_code", {
        code: { type: "string" },
      }),
    }
  );
  return stripCodeComments(normalizeMultilineText(parsed?.code), language);
}

async function refillLanguage({ companyName, item, language }) {
  const label = LANG_LABELS[language];
  // Must preserve indentation — compactSingleLine was collapsing Python/C++/Java
  // solutions into one line and the model then emitted broken suites.
  const previous = preserveCode(item?.solutions?.[language], 4000);

  let code = await generateLanguageCode({
    companyName,
    item,
    language,
    previous,
  });

  if (language === "python") {
    let result = finalizePythonSolution(code);

    // Only retry when python3 is present and rejected the syntax.
    if (!result.code && result.error && result.usedPython) {
      code = await generateLanguageCode({
        companyName,
        item,
        language,
        previous: code || previous,
        repairHint: [
          "Python rejected the previous attempt with:",
          result.error,
          "Rewrite the full solution with valid 4-space indentation.",
          "Never put statements after ':' on the same line.",
          "elif/else must align with if; put return in the correct block.",
        ].join(" "),
      });
      result = finalizePythonSolution(code);
    }

    // Last resort: ignore broken previous code and generate fresh.
    if (!result.code && result.error && result.usedPython) {
      code = await generateLanguageCode({
        companyName,
        item,
        language,
        previous: "",
        repairHint:
          "Write a brand-new valid Python solution from scratch. 4-space indents, one statement per line, no docstrings/comments.",
      });
      result = finalizePythonSolution(code);
    }

    // Prefer validated/reindented code; otherwise keep cleaned LLM output.
    code = result.code || stripPythonDocstringsJs(
      stripCodeComments(stripMarkdownFences(normalizeMultilineText(code)), "python")
    );
  }

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
