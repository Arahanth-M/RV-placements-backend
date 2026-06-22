/** Canonical program codes for PPO / SPC placement & conversion stats. */
export const PPO_PROGRAM_NAMES = Object.freeze({
  ai: "Artificial Intelligence & Machine Learning",
  as: "Aerospace Engineering",
  bt: "Biotechnology",
  cd: "Computer Science & Engineering – Data Science",
  ch: "Chemical Engineering",
  cs: "Computer Science & Engineering",
  cv: "Civil Engineering",
  cy: "Computer Science & Engineering – Cyber Security",
  ec: "Electronics & Communication Engineering",
  ee: "Electrical & Electronics Engineering",
  ei: "Electronics & Instrumentation Engineering",
  et: "Electronics & Telecommunication Engineering",
  im: "Industrial Engineering & Management",
  is: "Information Science & Engineering",
  me: "Mechanical Engineering",
});

/** Legacy codes stored before the 2-letter standard — map to canonical codes. */
export const PPO_BRANCH_LEGACY_ALIASES = Object.freeze({
  aiml: "ai",
  cse: "cs",
  ise: "is",
  ece: "ec",
  ete: "et",
  eie: "ei",
  eee: "ee",
  ase: "as",
  iem: "im",
  civil: "cv",
});

export const PPO_BRANCH_CODES_ARRAY = Object.freeze(
  Object.keys(PPO_PROGRAM_NAMES).sort((a, b) => a.localeCompare(b))
);

export const PPO_BRANCH_CODES = new Set(PPO_BRANCH_CODES_ARRAY);

export const CS_BRANCH_CODES = Object.freeze(["ai", "cd", "cs", "cy", "is"]);
export const EC_BRANCH_CODES = Object.freeze(["ec", "ee", "ei", "et"]);
export const ME_BRANCH_CODES = Object.freeze(["as", "im", "me"]);
export const CHEM_BRANCH_CODES = Object.freeze(["bt", "ch", "cv"]);

/**
 * @param {unknown} raw
 * @returns {string} canonical lowercase code, or trimmed lowercase input if unknown
 */
export function normalizePpoBranchCode(raw) {
  const bc = String(raw ?? "").trim().toLowerCase();
  if (!bc) return "";
  const aliased = PPO_BRANCH_LEGACY_ALIASES[bc] || bc;
  return PPO_BRANCH_CODES.has(aliased) ? aliased : bc;
}

/** @param {unknown} raw */
export function isValidPpoBranchCode(raw) {
  return PPO_BRANCH_CODES.has(normalizePpoBranchCode(raw));
}

/** @param {unknown} code */
export function formatPpoBranchLabel(code) {
  const normalized = normalizePpoBranchCode(code);
  const name = PPO_PROGRAM_NAMES[normalized];
  if (name) return `${normalized.toUpperCase()} — ${name}`;
  return String(code || "").trim().toUpperCase();
}
