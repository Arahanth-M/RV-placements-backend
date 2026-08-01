/**
 * Extract a numeric CGPA cutoff from free-text eligibility.
 * Returns null when no plausible cutoff (0–10 scale) is found.
 * If several cutoffs appear, returns the minimum (most inclusive for filtering).
 *
 * @param {unknown} text
 * @returns {number|null}
 */
export function extractMinCgpaFromEligibility(text) {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw) return null;

  /** @type {number[]} */
  const found = [];

  // (?<![\d.]) avoids matching a trailing digit from years like "2024 CGPA"
  const num = String.raw`(?<![\d.])(\d(?:\.\d{1,2})?)`;

  const patterns = [
    // "minimum CGPA 7.5", "at least 7 CGPA", ">= 7.5", "above 7.5 gpa"
    new RegExp(
      String.raw`(?:min(?:imum)?|at\s*least|above|over|greater\s*than|more\s*than|>=?)\s*(?:of\s*)?(?:cgpa|gpa)?\s*[:=]?\s*${num}\s*(?:\/\s*10)?`,
      "gi"
    ),
    // "CGPA: 7.5", "GPA of 8", "cgpa cut-off 7.0", "cgpa required 7.5"
    new RegExp(
      String.raw`(?:cgpa|gpa)\s*(?:cut[- ]?off|requirement|required|criteria)?\s*(?:of|:|=)?\s*(?:min(?:imum)?)?\s*${num}\s*(?:\/\s*10)?`,
      "gi"
    ),
    // "7.5 CGPA", "7.0/10 CGPA", "8+ CGPA", "7.5 and above CGPA"
    new RegExp(
      String.raw`${num}\s*(?:\/\s*10)?\s*(?:\+|and\s*above|or\s*above)?\s*(?:cgpa|gpa)`,
      "gi"
    ),
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(raw)) !== null) {
      const n = Number(match[1]);
      if (isPlausibleCgpa(n)) found.push(roundCgpa(n));
    }
  }

  if (found.length === 0) return null;
  return Math.min(...found);
}

/**
 * @param {number} n
 */
function isPlausibleCgpa(n) {
  return Number.isFinite(n) && n >= 0 && n <= 10;
}

/**
 * @param {number} n
 */
function roundCgpa(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Derive `minCgpa` from eligibility text for persistence.
 * Empty eligibility → null (clears previous value).
 *
 * @param {unknown} eligibility
 * @returns {number|null}
 */
export function minCgpaFromEligibilityText(eligibility) {
  const text = eligibility == null ? "" : String(eligibility).trim();
  if (!text) return null;
  return extractMinCgpaFromEligibility(text);
}
