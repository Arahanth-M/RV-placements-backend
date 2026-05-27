import {
  ACTION_VERBS,
  LIMITS,
  PASSIVE_PHRASE_PATTERNS,
  THRESHOLDS,
  WEAK_BULLET_PATTERNS,
  WEAK_VERB_PATTERNS,
} from "./constants.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "was",
  "will",
  "with",
  "you",
  "your",
  "our",
  "we",
  "they",
  "this",
  "these",
  "those",
  "their",
  "them",
  "can",
  "may",
  "must",
  "should",
  "would",
  "able",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "over",
  "such",
  "than",
  "then",
  "there",
  "when",
  "where",
  "who",
  "which",
  "while",
  "all",
  "any",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "own",
  "same",
  "so",
  "too",
  "very",
  "just",
  "also",
  "not",
  "only",
  "own",
  "per",
  "via",
  "etc",
  "role",
  "roles",
  "work",
  "working",
  "experience",
  "required",
  "preferred",
  "including",
  "using",
  "use",
  "used",
  "years",
  "year",
]);

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]/g, "")
    .trim();
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/i)
    .map((t) => normalizeToken(t))
    .filter((t) => t.length >= LIMITS.minTokenLength);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function hasNonEmptyText(text) {
  return String(text ?? "").trim().length > 0;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string[]} keys
 * @returns {number}
 */
export function countFilledFields(obj, keys) {
  if (!obj || typeof obj !== "object") return 0;
  return keys.filter((key) => hasNonEmptyText(obj[key])).length;
}

/**
 * @param {object} payload Sanitized resume draft payload.
 * @returns {string}
 */
export function extractResumePlainText(payload) {
  const parts = [];
  const personal = payload?.personal || {};

  for (const value of Object.values(personal)) {
    if (hasNonEmptyText(value)) parts.push(String(value).trim());
  }

  for (const skill of payload?.skills || []) {
    if (hasNonEmptyText(skill)) parts.push(String(skill).trim());
  }

  const pushSectionItems = (items, fieldKeys) => {
    for (const item of items || []) {
      for (const key of fieldKeys) {
        if (hasNonEmptyText(item?.[key])) parts.push(String(item[key]).trim());
      }
      for (const bullet of item?.bullets || []) {
        if (hasNonEmptyText(bullet?.text)) parts.push(String(bullet.text).trim());
      }
    }
  };

  pushSectionItems(payload?.education, [
    "institution",
    "degree",
    "field",
    "startDate",
    "endDate",
    "score",
    "location",
  ]);
  pushSectionItems(payload?.projects, ["name", "techStack", "link", "startDate", "endDate"]);
  pushSectionItems(payload?.experience, [
    "company",
    "role",
    "techStack",
    "location",
    "startDate",
    "endDate",
  ]);

  for (const cert of payload?.certifications || []) {
    if (hasNonEmptyText(cert?.title)) parts.push(String(cert.title).trim());
    if (hasNonEmptyText(cert?.link)) parts.push(String(cert.link).trim());
  }

  for (const achievement of payload?.achievements || []) {
    if (hasNonEmptyText(achievement?.title)) parts.push(String(achievement.title).trim());
    if (hasNonEmptyText(achievement?.detail)) parts.push(String(achievement.detail).trim());
  }

  return parts.join(" ");
}

/**
 * @typedef {{ text: string, section: "project" | "experience", context: string }} ResumeBullet
 */

/**
 * @param {object} payload Sanitized resume draft payload.
 * @returns {ResumeBullet[]}
 */
export function collectBullets(payload) {
  const bullets = [];

  for (const project of payload?.projects || []) {
    const context = String(project?.name || "").trim() || "Project";
    for (const bullet of project?.bullets || []) {
      if (!hasNonEmptyText(bullet?.text)) continue;
      bullets.push({
        text: String(bullet.text).trim(),
        section: "project",
        context,
      });
    }
  }

  for (const entry of payload?.experience || []) {
    const context =
      [entry?.role, entry?.company].filter(hasNonEmptyText).join(" at ") || "Experience";
    for (const bullet of entry?.bullets || []) {
      if (!hasNonEmptyText(bullet?.text)) continue;
      bullets.push({
        text: String(bullet.text).trim(),
        section: "experience",
        context,
      });
    }
  }

  return bullets;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function bulletHasMetric(text) {
  const value = String(text || "");
  return (
    /\d+%/.test(value) ||
    /\b\d+(\.\d+)?\s*(x|k|m|b)\b/i.test(value) ||
    /\b(increased|decreased|reduced|improved|saved|grew|cut)\b[^.]{0,40}\d+/i.test(value) ||
    /\$\s*\d+/.test(value) ||
    /\b\d+\+?\s*(users|customers|requests|ms|seconds|hours|days)\b/i.test(value)
  );
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function bulletHasActionVerb(text) {
  const words = tokenize(text);
  const verbSet = new Set(ACTION_VERBS.map(normalizeToken));
  return words.some((word) => verbSet.has(word));
}

/**
 * @param {string} text
 * @returns {boolean}
 */
/**
 * @param {string} text
 * @returns {boolean}
 */
export function bulletHasWeakVerb(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  if (WEAK_BULLET_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  return WEAK_VERB_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function bulletHasPassivePhrase(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  return PASSIVE_PHRASE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isWeakBullet(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return true;
  if (WEAK_BULLET_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  if (bulletHasWeakVerb(trimmed)) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length < LIMITS.minBulletWords;
}

/**
 * @param {string} text
 * @returns {{
 *   wordCount: number,
 *   charCount: number,
 *   hasActionVerb: boolean,
 *   hasMetric: boolean,
 *   hasWeakVerb: boolean,
 *   hasPassivePhrase: boolean,
 *   isWeak: boolean,
 *   idealLength: boolean,
 * }}
 */
export function analyzeBullet(text) {
  const trimmed = String(text || "").trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const charCount = trimmed.length;
  const wordCount = words.length;
  const hasMetric = bulletHasMetric(trimmed);
  const hasActionVerb = bulletHasActionVerb(trimmed);
  const hasWeakVerb = bulletHasWeakVerb(trimmed);
  const hasPassivePhrase = bulletHasPassivePhrase(trimmed);
  const weak = isWeakBullet(trimmed);
  const idealLength =
    charCount >= LIMITS.idealBulletMinChars &&
    charCount <= LIMITS.idealBulletMaxChars &&
    wordCount >= LIMITS.idealBulletWordsMin &&
    wordCount <= LIMITS.idealBulletWordsMax;

  return {
    wordCount,
    charCount,
    hasActionVerb,
    hasMetric,
    hasWeakVerb,
    hasPassivePhrase,
    isWeak: weak,
    idealLength,
  };
}

/** Nickname / casual tokens in the local part (substring match). */
const UNPROFESSIONAL_EMAIL_TOKENS = [
  "cool",
  "dude",
  "awesome",
  "ninja",
  "gamer",
  "gaming",
  "rockstar",
  "swag",
  "babe",
  "baby",
  "honey",
  "devil",
  "killer",
  "shadow",
  "dragon",
  "wolf",
  "tiger",
  "boss",
  "king",
  "queen",
  "lol",
  "haha",
  "crazy",
  "wild",
  "epic",
  "sniper",
  "noob",
  "rocker",
  "champ",
  "hero",
  "master",
  "rock",
  "star",
  "love",
  "sexy",
  "hot",
  "boy",
  "girl",
];

const UNPROFESSIONAL_EMAIL_LOCAL_PATTERNS = [/^[0-9]+$/, /[0-9]{5,}/, /(.)\1{3,}/];

/** Domains commonly used for throwaway addresses. */
const DISPOSABLE_EMAIL_DOMAINS = [
  "mailinator.com",
  "guerrillamail.com",
  "tempmail.com",
  "yopmail.com",
  "10minutemail.com",
  "throwaway.email",
];

/**
 * Basic RFC-like email shape (not full RFC validation).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBasicEmailFormat(value) {
  const s = String(value ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Heuristic: official / name-based email suitable for campus placements.
 * Institutional (.edu, .ac.in) addresses pass when format is valid.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isProfessionalEmail(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!isBasicEmailFormat(s)) return false;

  const at = s.lastIndexOf("@");
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!local || !domain) return false;

  if (/\.(edu|ac\.in|edu\.in)$/.test(domain) || domain.endsWith(".ac.in")) {
    return true;
  }

  if (DISPOSABLE_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return false;
  }

  if (local.length < 3 || local.length > 40) return false;

  if (UNPROFESSIONAL_EMAIL_TOKENS.some((token) => local.includes(token))) {
    return false;
  }

  if (UNPROFESSIONAL_EMAIL_LOCAL_PATTERNS.some((pattern) => pattern.test(local))) {
    return false;
  }

  const digits = (local.match(/\d/g) || []).length;
  if (digits > 0 && digits / local.length > 0.45) return false;

  if (/[^a-z0-9._+-]/.test(local)) return false;

  // e.g. 12345abc@ — numeric-heavy handles
  if (/^\d{4,}/.test(local)) return false;

  return true;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidLinkedInUrl(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  return /linkedin\.com\/(in|company|school)\//i.test(s) || /^https?:\/\/(www\.)?linkedin\.com/i.test(s);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidGitHubUrl(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  return /github\.com\/[\w.-]+/i.test(s);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidProjectLink(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  return /github\.com|gitlab\.com|bitbucket\.org/i.test(s);
}

/**
 * @param {unknown} scoreField Education score / CGPA text.
 * @returns {{ valid: boolean, kind: "cgpa"|"percentage"|"none", value: number|null }}
 */
export function parseEducationScore(scoreField) {
  const raw = String(scoreField ?? "").trim();
  if (!raw) return { valid: false, kind: "none", value: null };

  const cgpaLabelFirst = raw.match(/(?:cgpa|gpa)\s*:?\s*(\d{1,2}(?:\.\d{1,2})?)/i);
  if (cgpaLabelFirst) {
    const value = Number(cgpaLabelFirst[1]);
    const valid = value >= LIMITS.minCgpa && value <= LIMITS.maxCgpa;
    return { valid, kind: "cgpa", value };
  }

  const cgpaMatch = raw.match(/\b(\d{1,2}(?:\.\d{1,2})?)\s*(?:\/\s*10|cgpa|gpa)\b/i);
  if (cgpaMatch) {
    const value = Number(cgpaMatch[1]);
    const valid = value >= LIMITS.minCgpa && value <= LIMITS.maxCgpa;
    return { valid, kind: "cgpa", value };
  }

  const plainCgpa = raw.match(/^(\d{1,2}(?:\.\d{1,2})?)$/);
  if (plainCgpa) {
    const value = Number(plainCgpa[1]);
    if (value >= LIMITS.minCgpa && value <= LIMITS.maxCgpa) {
      return { valid: true, kind: "cgpa", value };
    }
  }

  const pctMatch = raw.match(/(\d{1,3}(?:\.\d{1,2})?)\s*%/);
  if (pctMatch) {
    const value = Number(pctMatch[1]);
    const valid = value >= LIMITS.minPercentage && value <= LIMITS.maxPercentage;
    return { valid, kind: "percentage", value };
  }

  return { valid: false, kind: "none", value: null };
}

/**
 * @param {unknown} scoreField
 * @returns {number} 0–100
 */
export function scoreEducationCgpa(scoreField) {
  const parsed = parseEducationScore(scoreField);
  if (!parsed.valid) return parsed.kind === "none" ? 35 : 50;
  if (parsed.kind === "cgpa") {
    if (parsed.value >= 8) return 100;
    if (parsed.value >= 7) return 85;
    if (parsed.value >= 6) return 70;
    return 55;
  }
  if (parsed.kind === "percentage") {
    if (parsed.value >= 80) return 100;
    if (parsed.value >= 70) return 85;
    if (parsed.value >= 60) return 70;
    return 55;
  }
  return 50;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isStopWord(token) {
  return STOP_WORDS.has(normalizeToken(token));
}

/**
 * @param {string} text
 * @returns {Set<string>}
 */
export function buildTokenSet(text) {
  return new Set(tokenize(text).filter((t) => !isStopWord(t)));
}

/**
 * @param {Record<string, unknown>} entry
 * @param {string[]} keys
 * @returns {boolean}
 */
export function isEntrySubstantiallyFilled(entry, keys) {
  return countFilledFields(entry, keys) >= Math.min(keys.length, THRESHOLDS.minFilledEducationFields);
}

/**
 * Light heuristic to determine whether a date string looks like:
 * - "2022"
 * - "Aug 2022"
 * - "Jan 2025"
 *
 * This is intentionally forgiving because frontend sends short free-form strings.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDateLike(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (/^\d{4}$/.test(lower)) return true; // year only
  // Month + year (e.g. "Aug 2022", "September 2022")
  if (/^[a-z]{3,9}\s+\d{4}$/.test(lower)) return true;
  // "MM/YYYY"
  if (/^\d{1,2}\/\d{4}$/.test(lower)) return true;
  return false;
}

/**
 * @param {unknown} startDate
 * @param {unknown} endDate
 * @returns {number} 0–100
 */
export function scoreDateRange(startDate, endDate) {
  const startOk = isDateLike(startDate);
  const endOk = isDateLike(endDate);
  const filled = [startOk, endOk].filter(Boolean).length;
  if (!startDate && !endDate) return 100;
  if (filled === 2) return 100;
  if (filled === 1) return 60;
  return 40;
}

export { STOP_WORDS };
