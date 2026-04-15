/**
 * Removes common HTML/script/style blocks, dangerous tags, inline event handlers,
 * and javascript: / data: URL schemes from strings in req.body.
 * Only mutates string leaves; leaves numbers, booleans, null, Dates, Buffers unchanged.
 */

const BLOCK_PATTERNS = [
  /<script\b[^>]*>[\s\S]*?<\/script>/gi,
  /<style\b[^>]*>[\s\S]*?<\/style>/gi,
  /<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi,
  /<object\b[^>]*>[\s\S]*?<\/object>/gi,
  /<embed\b[^>]*>[\s\S]*?<\/embed>/gi,
  /<link\b[^>]*>/gi,
  /<meta\b[^>]*>/gi,
];

/** Tag names only (after `<` or `</`), so plain text like `a < b` or `List<String>` is untouched. */
const DANGEROUS_TAG = /<\/?\s*(?:script|style|iframe|object|embed|form|svg|link|meta|base|body|html|head|img|video|audio|source|input|button|textarea|select|option|noscript)\b[^>]*>/gi;

/** Inline event handlers (onclick, onerror, onload, onfocus, SVG onload, etc.) inside a tag fragment. */
const EVENT_ATTR_IN_TAG = /\s+on[a-z][\w-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

/** Opening/closing angle bracket + tag-like name; avoids treating `a < b` as a tag. */
const TAG_LIKE_OPEN = /^<\/?\s*[a-zA-Z!?:]/;

/** Max length of a single removed data: / javascript: segment (avoids pathological strings). */
const MAX_SCHEME_TAIL = 2_000_000;

/**
 * Fields that contain code / rich text where `<...>` should be preserved
 * (e.g. vector<int>, #include<stdio.h>, generics/templates).
 */
const RAW_TEXT_FIELDS = new Set([
  "content",
  "question",
  "questions",
  "solution",
  "solutions",
  "answer",
  "answers",
  "code",
  "solution_code",
  "explanation",
  "onlineQuestions",
  "onlineQuestions_solution",
  "interviewQuestions",
  "interviewQuestions_solution",
  "interviewProcess",
  "prev_coding_ques",
  "Must_Do_Topics",
  "internshipExperience",
]);

function stripDangerousSchemes(str) {
  const jsRe = new RegExp(`(?<![/:])\\bjavascript\\s*:[^\\s"'<>]{0,${MAX_SCHEME_TAIL}}`, "gi");
  const dataRe = new RegExp(`(?<![/:])\\bdata\\s*:[^\\s"'<>]{0,${MAX_SCHEME_TAIL}}`, "gi");
  return str.replace(jsRe, "").replace(dataRe, "");
}

function stripEventHandlersInsideTags(str) {
  return str.replace(/<([^>]+)>/g, (full, inner) => {
    if (typeof inner !== "string" || !TAG_LIKE_OPEN.test(full)) {
      return full;
    }
    const cleaned = inner.replace(EVENT_ATTR_IN_TAG, "");
    return `<${cleaned}>`;
  });
}

function sanitizeString(str) {
  if (typeof str !== "string" || str.length === 0) {
    return str;
  }
  let out = str;
  for (const re of BLOCK_PATTERNS) {
    out = out.replace(re, "");
  }
  out = out.replace(DANGEROUS_TAG, "");
  out = stripEventHandlersInsideTags(out);
  out = stripDangerousSchemes(out);
  return out;
}

function shouldPreserveRawText(path) {
  if (!Array.isArray(path) || path.length === 0) return false;
  return path.some((segment) => RAW_TEXT_FIELDS.has(String(segment)));
}

function sanitizeValue(value, path = []) {
  if (typeof value === "string") {
    if (shouldPreserveRawText(path)) return value;
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = sanitizeValue(value[i], [...path, i]);
    }
    return value;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    return value;
  }
  for (const key of Object.keys(value)) {
    value[key] = sanitizeValue(value[key], [...path, key]);
  }
  return value;
}

export default function sanitizeInput(req, res, next) {
  if (req.body != null && typeof req.body === "object") {
    sanitizeValue(req.body);
  }
  next();
}
