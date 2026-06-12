/** Strip dangerous HTML/script tags from submission text before persisting on company visits. */
export function sanitizeSubmissionText(text) {
  if (text === undefined || text === null) return "";
  let str = String(text);
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  str = str.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  str = str.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  str = str.replace(
    /<\/?\s*(?:script|style|iframe|object|embed|form|svg|link|meta|base|body|html|head|img|video|audio|source|input|button|textarea|select|option|noscript)\b[^>]*>/gi,
    ""
  );
  str = str.replace(/\s+on[a-z][\w-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  str = str.replace(/(?<![/:])\bjavascript\s*:[^\s"'<>]*/gi, "");
  str = str.replace(/(?<![/:])\bdata\s*:[^\s"'<>]*/gi, "");
  return str.trim();
}
