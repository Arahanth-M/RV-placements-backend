import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const MAX_RESUME_CHARS = 28000;

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract plain text from an uploaded resume buffer.
 * Supports PDF and DOCX. Does not persist the file.
 */
export async function extractResumeText({ buffer, mime, originalName }) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error("Resume file is empty.");
    err.code = "RESUME_EMPTY";
    throw err;
  }

  const name = String(originalName || "").toLowerCase();
  const mimeLower = String(mime || "").toLowerCase();
  const isPdf =
    mimeLower.includes("pdf") || name.endsWith(".pdf");
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
    const err = new Error("Upload a PDF or DOCX resume.");
    err.code = "RESUME_TYPE";
    throw err;
  }

  const text = normalizeWhitespace(raw).slice(0, MAX_RESUME_CHARS);
  if (text.length < 40) {
    const err = new Error(
      "Could not read enough text from the resume. Try another PDF/DOCX."
    );
    err.code = "RESUME_PARSE";
    throw err;
  }

  return text;
}

/** Compact digest for storage / prompts (skills, projects, experience cues). */
export function buildResumeDigest(fullText, maxLen = 2800) {
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
