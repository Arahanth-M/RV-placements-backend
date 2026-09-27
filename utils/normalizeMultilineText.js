/** Preserve line breaks from LLM / JSON (do not collapse to one line). */
export function normalizeMultilineText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .trim();
}

export function compactSingleLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
