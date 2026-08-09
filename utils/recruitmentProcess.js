/** @typedef {'technical' | 'aptitude' | 'resume_based' | 'projects' | 'other'} RecruitmentRoundType */

export const RECRUITMENT_ROUND_TYPES = [
  "technical",
  "aptitude",
  "resume_based",
  "projects",
  "other",
];

export const RECRUITMENT_ROUND_TYPE_LABELS = {
  technical: "Technical",
  aptitude: "Aptitude",
  resume_based: "Resume Based",
  projects: "Projects",
  other: "Other",
};

export const OA_ASSESSMENT_MODES = ["online", "offline"];

export const OA_ASSESSMENT_MODE_LABELS = {
  online: "Online",
  offline: "Offline",
};

const MAX_ROUNDS = 20;
const MAX_TOPICS_LEN = 2000;
const MAX_OTHER_LABEL_LEN = 200;

/**
 * Parse optional non-negative integer. Blank/null → null (unknown).
 * Invalid non-blank → undefined (caller should reject).
 * @param {unknown} value
 * @returns {number|null|undefined}
 */
function parseOptionalNonNegInt(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const n = typeof value === "number" ? value : Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return undefined;
  return Math.floor(n);
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function parseNonNegInt(value) {
  const parsed = parseOptionalNonNegInt(value);
  return parsed === undefined ? null : parsed;
}

/**
 * @param {unknown} text
 * @param {number} maxLen
 * @returns {string}
 */
function sanitizeTextField(text, maxLen) {
  if (text == null) return "";
  return String(text).trim().slice(0, maxLen);
}

/**
 * Accept legacy `type` string or `types` array → unique valid list.
 * @param {Record<string, unknown>} raw
 * @returns {string[]}
 */
export function normalizeRoundTypesFromRaw(raw) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  const push = (value) => {
    const type = sanitizeTextField(value, 32).toLowerCase();
    if (!RECRUITMENT_ROUND_TYPES.includes(type) || seen.has(type)) return;
    seen.add(type);
    out.push(type);
  };

  if (Array.isArray(raw?.types)) {
    for (const t of raw.types) push(t);
  }
  if (out.length === 0) push(raw?.type);
  return out;
}

/**
 * Normalize and validate recruitment process payload from API.
 * @param {unknown} input
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, error: string }}
 */
export function sanitizeRecruitmentProcess(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid recruitment process payload." };
  }

  const rawOa = /** @type {Record<string, unknown>} */ (input).onlineAssessment;
  const oaOccurred =
    rawOa && typeof rawOa === "object" && !Array.isArray(rawOa)
      ? rawOa.occurred === true || rawOa.occurred === "true"
      : false;
  /** @type {Record<string, unknown>} */
  const onlineAssessment = { occurred: oaOccurred };

  if (oaOccurred) {
    const oa = /** @type {Record<string, unknown>} */ (rawOa);
    const mode = sanitizeTextField(oa.mode, 16).toLowerCase();
    if (OA_ASSESSMENT_MODES.includes(mode)) {
      onlineAssessment.mode = mode;
    }
    const topics = sanitizeTextField(oa.topics, MAX_TOPICS_LEN);
    if (topics) onlineAssessment.topics = topics;
    const attended = parseOptionalNonNegInt(oa.attended);
    const cleared = parseOptionalNonNegInt(oa.cleared);
    if (attended === undefined) {
      return {
        ok: false,
        error: "OA attended must be blank (unknown) or a whole number 0 or more.",
      };
    }
    if (cleared === undefined) {
      return {
        ok: false,
        error: "OA cleared must be blank (unknown) or a whole number 0 or more.",
      };
    }
    if (attended != null && cleared != null && cleared > attended) {
      return { ok: false, error: "OA cleared count cannot exceed attended count." };
    }
    if (attended != null) onlineAssessment.attended = attended;
    if (cleared != null) onlineAssessment.cleared = cleared;
  }

  const rawRounds = Array.isArray(
    /** @type {Record<string, unknown>} */ (input).rounds
  )
    ? /** @type {unknown[]} */ (
        /** @type {Record<string, unknown>} */ (input).rounds
      )
    : [];
  if (rawRounds.length > MAX_ROUNDS) {
    return { ok: false, error: `At most ${MAX_ROUNDS} rounds are allowed.` };
  }

  /** @type {Record<string, unknown>[]} */
  const rounds = [];

  for (let i = 0; i < rawRounds.length; i++) {
    const raw = rawRounds[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `Round ${i + 1} is invalid.` };
    }
    const roundNumber =
      parseNonNegInt(raw.roundNumber) != null && parseNonNegInt(raw.roundNumber) > 0
        ? parseNonNegInt(raw.roundNumber)
        : i + 1;
    const occurred = raw.occurred === true || raw.occurred === "true";
    /** @type {Record<string, unknown>} */
    const round = { roundNumber, occurred };

    if (occurred) {
      const types = normalizeRoundTypesFromRaw(
        /** @type {Record<string, unknown>} */ (raw)
      );
      if (types.length > 0) {
        round.types = types;
        // Keep scalar `type` for older readers / timeline fallbacks.
        round.type = types[0];
      }

      if (types.includes("other")) {
        const otherTypeLabel = sanitizeTextField(raw.otherTypeLabel, MAX_OTHER_LABEL_LEN);
        if (otherTypeLabel) round.otherTypeLabel = otherTypeLabel;
      }

      const mode = sanitizeTextField(raw.mode, 16).toLowerCase();
      if (OA_ASSESSMENT_MODES.includes(mode)) {
        round.mode = mode;
      }

      const attended = parseOptionalNonNegInt(raw.attended);
      const cleared = parseOptionalNonNegInt(raw.cleared);
      if (attended === undefined) {
        return {
          ok: false,
          error: `Round ${roundNumber}: attended must be blank (unknown) or a whole number 0 or more.`,
        };
      }
      if (cleared === undefined) {
        return {
          ok: false,
          error: `Round ${roundNumber}: cleared must be blank (unknown) or a whole number 0 or more.`,
        };
      }
      if (attended != null && cleared != null && cleared > attended) {
        return {
          ok: false,
          error: `Round ${roundNumber}: cleared count cannot exceed attended count.`,
        };
      }
      if (attended != null) round.attended = attended;
      if (cleared != null) round.cleared = cleared;
    }

    rounds.push(round);
  }

  return {
    ok: true,
    value: { onlineAssessment, rounds },
  };
}

/**
 * Resolve display identity for the SPC/Admin who saved recruitment process.
 * @param {Record<string, unknown>|null|undefined} reqUser — JWT claims on req.user
 * @param {Record<string, unknown>|null|undefined} [studentLean] — Student row when found
 * @returns {{ name: string, email: string, usn: string }}
 */
export function buildRecruitmentProcessSubmitter(reqUser, studentLean = null) {
  const email = String(reqUser?.email || studentLean?.email || "")
    .trim()
    .toLowerCase();
  const nameFromStudent =
    studentLean?.name != null ? String(studentLean.name).trim() : "";
  const nameFromJwt =
    reqUser?.username != null ? String(reqUser.username).trim() : "";
  const name = nameFromStudent || nameFromJwt || email || "SPC";
  const usn =
    studentLean?.usn != null ? String(studentLean.usn).trim().toUpperCase() : "";
  return { name, email, usn };
}

/**
 * Attach server-side submitter metadata to a sanitized recruitment process payload.
 * @param {Record<string, unknown>} processValue
 * @param {Record<string, unknown>|null|undefined} reqUser
 * @param {Record<string, unknown>|null|undefined} [studentLean]
 */
export function withRecruitmentProcessSubmitter(processValue, reqUser, studentLean = null) {
  return {
    ...processValue,
    submittedBy: buildRecruitmentProcessSubmitter(reqUser, studentLean),
    submittedAt: new Date().toISOString(),
  };
}

/**
 * @param {unknown} value
 * @returns {{ name?: string, email?: string, usn?: string }|null}
 */
export function getRecruitmentProcessSubmitter(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sb = /** @type {Record<string, unknown>} */ (value).submittedBy;
  if (!sb || typeof sb !== "object" || Array.isArray(sb)) return null;
  const name = sb.name != null ? String(sb.name).trim() : "";
  const email = sb.email != null ? String(sb.email).trim() : "";
  const usn = sb.usn != null ? String(sb.usn).trim() : "";
  if (!name && !email && !usn) return null;
  return { name, email, usn };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRecruitmentProcessEmpty(value) {
  if (value == null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return true;
  const oa = /** @type {Record<string, unknown>} */ (value).onlineAssessment;
  const rounds = /** @type {Record<string, unknown>} */ (value).rounds;
  const oaOccurred =
    oa &&
    typeof oa === "object" &&
    !Array.isArray(oa) &&
    (oa.occurred === true || oa.occurred === "true");
  const hasRound =
    Array.isArray(rounds) &&
    rounds.some(
      (r) =>
        r &&
        typeof r === "object" &&
        !Array.isArray(r) &&
        (r.occurred === true || r.occurred === "true")
    );
  return !oaOccurred && !hasRound;
}
