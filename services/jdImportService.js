import { createRequire } from "module";
import { callLLM } from "./llmClient.js";
import { sanitizeRoleText } from "../utils/normalizeAdminRole.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const MIN_PDF_TEXT_CHARS = 40;
/** ~20–30 pages of typical JD text; Groq context can handle this for scan/extract. */
const MAX_PDF_TEXT_FOR_LLM = 100_000;

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ text: string, numpages?: number, pagesRendered?: number, pagesWithText?: number }>}
 */
export async function extractTextFromPdfBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("PDF file is empty or missing.");
  }

  // max: 0 → render every page (pdf-parse default, set explicitly).
  const pageTexts = [];
  const result = await pdfParse(buffer, {
    max: 0,
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });
      let lastY;
      let text = "";
      for (const item of textContent.items || []) {
        const str = String(item?.str ?? "");
        if (!str) continue;
        const y = item?.transform?.[5];
        if (lastY == null || y === lastY) {
          text += str;
        } else {
          text += `\n${str}`;
        }
        lastY = y;
      }
      const cleaned = text.replace(/[ \t]+\n/g, "\n").trim();
      pageTexts.push(cleaned);
      return cleaned;
    },
  });

  const numpages = Number(result?.numpages) || pageTexts.length || 0;
  const pagesWithText = pageTexts.filter((p) => p.length > 0).length;

  // Prefer our per-page join (clear page breaks) over pdf-parse's concatenated string.
  const textFromPages = pageTexts
    .map((pageText, index) => {
      const body = String(pageText || "").trim();
      if (!body) return `--- Page ${index + 1} (no extractable text) ---`;
      return `--- Page ${index + 1} ---\n${body}`;
    })
    .join("\n\n");

  const fallback = String(result?.text || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const text = (textFromPages.trim() || fallback)
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length < MIN_PDF_TEXT_CHARS) {
    throw new Error(
      "Could not extract enough text from this PDF. It may be scanned/image-only (OCR not supported yet)."
    );
  }

  if (numpages > 1 && pagesWithText < numpages) {
    console.warn(
      `[jd-import] PDF has ${numpages} pages but only ${pagesWithText} had extractable text (others may be image-only).`
    );
  }

  return {
    text,
    numpages,
    pagesRendered: pageTexts.length || numpages,
    pagesWithText,
  };
}

/**
 * @param {unknown} fields
 * @returns {string[]}
 */
export function normalizeExtractFieldNames(fields) {
  const list = Array.isArray(fields)
    ? fields
    : typeof fields === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(fields);
            return Array.isArray(parsed) ? parsed : String(fields).split(",");
          } catch {
            return String(fields).split(",");
          }
        })()
      : [];
  const seen = new Set();
  const out = [];
  for (const f of list) {
    const name = sanitizeRoleText(f);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Parse model JSON, tolerating optional markdown fences.
 * @param {string} raw
 * @returns {Record<string, unknown>}
 */
function parseJsonObjectFromLlm(raw) {
  let s = String(raw || "").trim();
  if (!s) throw new Error("LLM returned empty content.");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM did not return a JSON object.");
  }
  const parsed = JSON.parse(s.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM JSON was not an object.");
  }
  return parsed;
}

/**
 * Clip JD text for LLM prompts.
 * @param {string} text
 */
function clipJdTextForLlm(text) {
  const t = String(text || "");
  return t.length > MAX_PDF_TEXT_FOR_LLM
    ? `${t.slice(0, MAX_PDF_TEXT_FOR_LLM)}\n\n[...truncated...]`
    : t;
}

/**
 * Suggest section / field names present in a JD (no values yet).
 * Skips compensation / monetary headings.
 * @param {{ text: string, roleName?: string }} opts
 * @returns {Promise<string[]>}
 */
export async function suggestJdFieldNamesWithLlm({ text, roleName = "" }) {
  const clipped = clipJdTextForLlm(text);
  const roleHint = roleName
    ? `The admin believes this JD is for role: "${roleName}". Prefer sections for that role if multiple appear.`
    : "No role name was provided.";

  const system = [
    "You scan campus-placement job-description PDF text and list useful field/section names only.",
    "Return ONLY a single JSON object shaped like: {\"fields\":[\"...\"]}. No markdown, no commentary.",
    "Each item must be a short human-readable heading or content category found in (or clearly supported by) the text.",
    "Good examples: skills, technical skills, responsibilities, work, role overview, requirements, eligibility, location, education.",
    "The JD text may span MULTIPLE pages (see --- Page N --- markers). Use headings/content from ALL pages, not only the first.",
    "Do NOT invent sections that are not present.",
    "Do NOT include compensation / money fields (CTC, salary, stipend, base, bonus, stock, equity, package, LPA, etc.).",
    "Prefer 4–12 concise names. Deduplicate near-duplicates.",
  ].join(" ");

  const user = [roleHint, "JD text:", clipped].join("\n\n");

  const raw = await callLLM(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.1, max_tokens: 1024 }
  );

  const parsed = parseJsonObjectFromLlm(raw);
  const list = Array.isArray(parsed.fields)
    ? parsed.fields
    : Array.isArray(parsed.fieldNames)
      ? parsed.fieldNames
      : Array.isArray(parsed.sections)
        ? parsed.sections
        : [];

  const MONEY_RE =
    /\b(ctc|salary|stipend|compensation|package|lpa|base pay|bonus|stock|equity|rs\.?|inr|remuneration|pay\b|monetary)\b/i;

  return normalizeExtractFieldNames(list).filter((name) => !MONEY_RE.test(name));
}

/**
 * Ask Groq to extract only the requested field names from JD text.
 * @param {{ text: string, fields: string[], roleName?: string }} opts
 */
export async function extractJdFieldsWithLlm({ text, fields, roleName = "" }) {
  const fieldList = normalizeExtractFieldNames(fields);
  if (fieldList.length === 0) {
    throw new Error("At least one field name to extract is required.");
  }

  const clipped = clipJdTextForLlm(text);

  const roleHint = roleName
    ? `The admin believes this JD is for role: "${roleName}". Prefer facts for that role if multiple appear.`
    : "No role name was provided; extract company/role-agnostic fields if present.";

  const system = [
    "You extract structured placement job-description fields from PDF text.",
    "Return ONLY a single JSON object. No markdown, no commentary.",
    "Include ONLY keys from the requested field list. Omit keys that are not found.",
    'For a field named "skills" (case-insensitive) or any skills-like heading: if listed as bullets/numbered points, return a JSON array of strings — one clean point per item, without leading bullets/numbers. If short prose, return a single string. Do NOT return a flat comma-separated skill tag list unless the JD itself is written that way.',
    'For "workDescription", "work", "responsibilities", or duty/role-description headings: if listed as bullets/numbered points, return a JSON array of strings — one clean point per item, without leading bullets/numbers. If short prose, return a single string.',
    "The JD text may span MULTIPLE pages (see --- Page N --- markers). Read and use content from ALL pages, not only page 1.",
    "Do not invent values that are not supported by the text.",
    "Do not extract compensation/salary/CTC unless that exact key was requested.",
  ].join(" ");

  const user = [
    roleHint,
    `Requested fields: ${JSON.stringify(fieldList)}`,
    "JD text:",
    clipped,
  ].join("\n\n");

  const raw = await callLLM(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.1, max_tokens: 2048 }
  );

  const parsed = parseJsonObjectFromLlm(raw);
  /** @type {Record<string, unknown>} */
  const extracted = {};
  const wanted = new Map(fieldList.map((f) => [f.toLowerCase(), f]));

  for (const [k, v] of Object.entries(parsed)) {
    const canon = wanted.get(String(k).trim().toLowerCase());
    if (!canon) continue;
    if (v === null || v === undefined || v === "") continue;
    const nk = canon.toLowerCase().replace(/\s+/g, "");
    const isPointsField =
      nk === "skills" ||
      nk.includes("skill") ||
      nk === "workdescription" ||
      nk === "work" ||
      nk === "responsibilities" ||
      nk.includes("responsib") ||
      nk.includes("duties");
    if (isPointsField) {
      if (Array.isArray(v)) {
        const points = v
          .map((item) =>
            sanitizeRoleText(item)
              .replace(/^[-*•]+\s*/, "")
              .replace(/^\d+[.)]\s*/, "")
              .trim()
          )
          .filter(Boolean);
        if (points.length === 0) continue;
        extracted[canon] = points.length === 1 ? points[0] : points;
      } else {
        const pointsText = sanitizeRoleText(v);
        if (!pointsText) continue;
        extracted[canon] = pointsText;
      }
      continue;
    }
    extracted[canon] = v;
  }

  return extracted;
}
