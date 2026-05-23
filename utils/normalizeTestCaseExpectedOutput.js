const HTML_ENTITY_MAP = {
  "&quot;": '"',
  "&#34;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
};

const decodeHtmlEntitiesInString = (raw) =>
  String(raw || "").replace(
    /&quot;|&#34;|&#39;|&apos;|&lt;|&gt;|&amp;/g,
    (match) => HTML_ENTITY_MAP[match] ?? match
  );

const tryParseJsonLiteral = (decoded) => {
  const s = decoded.trim();
  if (!s) return null;
  const first = s[0];
  if (
    first === "[" ||
    first === "{" ||
    first === '"' ||
    first === "-" ||
    (first >= "0" && first <= "9") ||
    s === "true" ||
    s === "false" ||
    s === "null"
  ) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * Decode HTML entities and parse JSON string literals into native JSON values.
 * @param {unknown} value
 * @returns {unknown}
 */
export const normalizeExpectedOutput = (value) => {
  if (value == null) return value;
  if (typeof value !== "string") return value;

  const decoded = decodeHtmlEntitiesInString(value).trim();
  if (!decoded) return value;

  const parsed = tryParseJsonLiteral(decoded);
  return parsed == null ? decoded : parsed;
};

/**
 * @param {object} testcase
 * @returns {object}
 */
export const normalizeTestCaseFields = (testcase) => {
  if (!testcase || typeof testcase !== "object") return testcase;
  return {
    ...testcase,
    expectedOutput: normalizeExpectedOutput(testcase.expectedOutput),
    isHidden: Boolean(testcase.isHidden),
    weight: Number(testcase.weight) > 0 ? Number(testcase.weight) : 1,
  };
};

export default normalizeExpectedOutput;
