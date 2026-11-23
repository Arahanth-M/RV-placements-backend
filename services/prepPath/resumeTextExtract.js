import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const MAX_RESUME_CHARS = 28000;

/**
 * Clean PDF/DOCX extract artifacts: mid-word wraps, one-word-per-line columns,
 * and excess blank lines — keep real paragraph breaks.
 */
const RESUME_SECTION_HEADER_RE =
  /^(name\s*\/\s*headline|summary|profile|objective|about(\s+me)?|education|academic(\s+background)?|experience|work\s+experience|internship|employment|projects?|skills?(\s*\/\s*languages?)?|technical\s+skills?|languages?|technologies|tech\s+stack|tools?|frameworks?|concepts?|certifications?|additional\s+notes|other)\s*:?\s*$/i;

export function normalizeWhitespace(text) {
  let out = String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/([A-Za-z])-\n([A-Za-z])/g, "$1$2")
    .replace(/([A-Za-z])\n([a-z])/g, "$1$2");

  // Soft-join wraps, but keep real section headers / bullets on their own lines.
  out = out.replace(/([^\n.!?•|:;])\n(?=[A-Za-z0-9(•\u2022\-*])/g, (full, prev, offset) => {
    const after = out.slice(offset + full.length);
    const nextLine = (after.split("\n")[0] || "").trim();
    if (RESUME_SECTION_HEADER_RE.test(nextLine)) return `${prev}\n`;
    if (/^([•\u2022\-*]|\d+[.)])\s*/.test(nextLine)) return `${prev}\n`;
    return `${prev} `;
  });

  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract plain text from an uploaded PDF/DOCX buffer.
 * Supports PDF and DOCX. Does not persist the file.
 */
export async function extractDocumentText({
  buffer,
  mime,
  originalName,
  label = "document",
  minChars = 40,
  emptyCode = "DOCUMENT_EMPTY",
  typeCode = "DOCUMENT_TYPE",
  parseCode = "DOCUMENT_PARSE",
}) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error(`${label} file is empty.`);
    err.code = emptyCode;
    throw err;
  }

  const name = String(originalName || "").toLowerCase();
  const mimeLower = String(mime || "").toLowerCase();
  const isPdf = mimeLower.includes("pdf") || name.endsWith(".pdf");
  const isDocx =
    mimeLower.includes("wordprocessingml") ||
    mimeLower.includes("officedocument") ||
    name.endsWith(".docx");

  let raw = "";
  if (isPdf) {
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      raw = parsed?.text || "";
    } finally {
      await parser.destroy().catch(() => {});
    }
  } else if (isDocx) {
    const result = await mammoth.extractRawText({ buffer });
    raw = result?.value || "";
  } else {
    const err = new Error(`Upload a PDF or DOCX ${label}.`);
    err.code = typeCode;
    throw err;
  }

  const text = normalizeWhitespace(raw).slice(0, MAX_RESUME_CHARS);
  if (text.length < minChars) {
    const err = new Error(
      `Could not read enough text from the ${label}. Try another PDF/DOCX.`
    );
    err.code = parseCode;
    throw err;
  }

  return text;
}

/** Extract plain text from an uploaded resume buffer. */
export async function extractResumeText({ buffer, mime, originalName }) {
  return extractDocumentText({
    buffer,
    mime,
    originalName,
    label: "resume",
    minChars: 40,
    emptyCode: "RESUME_EMPTY",
    typeCode: "RESUME_TYPE",
    parseCode: "RESUME_PARSE",
  });
}

/** Extract plain text from an optional uploaded job description. */
export async function extractJdText({ buffer, mime, originalName }) {
  return extractDocumentText({
    buffer,
    mime,
    originalName,
    label: "job description",
    minChars: 80,
    emptyCode: "JD_EMPTY",
    typeCode: "JD_TYPE",
    parseCode: "JD_PARSE",
  });
}

/** Compact digest for storage / prompts (skills, projects, experience cues). */
export function buildResumeDigest(fullText, maxLen = 1500) {
  const text = normalizeWhitespace(fullText);
  if (text.length <= maxLen) return text;

  const prefer =
    text.match(
      /(?:skills|projects|experience|education|technologies|summary)[\s\S]{0,1200}/gi
    ) || [];
  const joined = prefer.join("\n\n").trim();
  if (joined.length >= 400) {
    return joined.slice(0, maxLen);
  }
  return text.slice(0, maxLen);
}

/** Compact JD digest for the LLM prompt only — not stored on the plan. */
export function buildJdDigest(fullText, maxLen = 2000) {
  const text = normalizeWhitespace(fullText);
  if (text.length <= maxLen) return text;

  const prefer =
    text.match(
      /(?:requirements|qualifications|responsibilities|skills|must have|good to have|about the role|about you|what you|what we|job description|role overview|eligibility|experience)[\s\S]{0,1600}/gi
    ) || [];
  const joined = prefer.join("\n\n").trim();
  if (joined.length >= 500) {
    return joined.slice(0, maxLen);
  }
  return text.slice(0, maxLen);
}
