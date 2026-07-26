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
 * @param {unknown} value
 * @returns {number|null}
 */
function parseNonNegInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(String(value).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
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
 * Normalize and validate recruitment process payload from API.
 * @param {unknown} input
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, error: string }}
 */
export function sanitizeRecruitmentProcess(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid recruitment process payload." };
  }

  const rawOa = /** @type {Record<string, unknown>} */ (input).onlineAssessment;
  if (!rawOa || typeof rawOa !== "object" || Array.isArray(rawOa)) {
    return { ok: false, error: "onlineAssessment is required." };
  }

  const oaOccurred = rawOa.occurred === true || rawOa.occurred === "true";
  /** @type {Record<string, unknown>} */
  const onlineAssessment = { occurred: oaOccurred };

  if (oaOccurred) {
    const mode = sanitizeTextField(rawOa.mode, 16).toLowerCase();
    if (!OA_ASSESSMENT_MODES.includes(mode)) {
      return {
        ok: false,
        error: "Select online or offline mode for the online assessment.",
      };
    }
    const topics = sanitizeTextField(rawOa.topics, MAX_TOPICS_LEN);
    if (!topics) {
      return { ok: false, error: "OA topics are required when online assessment occurred." };
    }
    const attended = parseNonNegInt(rawOa.attended);
    const cleared = parseNonNegInt(rawOa.cleared);
    if (attended == null) {
      return { ok: false, error: "OA attended count is required when online assessment occurred." };
    }
    if (cleared == null) {
      return { ok: false, error: "OA cleared count is required when online assessment occurred." };
    }
    if (cleared > attended) {
      return { ok: false, error: "OA cleared count cannot exceed attended count." };
    }
    onlineAssessment.topics = topics;
    onlineAssessment.mode = mode;
    onlineAssessment.attended = attended;
    onlineAssessment.cleared = cleared;
  }

  const rawRounds = /** @type {Record<string, unknown>} */ (input).rounds;
  if (!Array.isArray(rawRounds)) {
    return { ok: false, error: "rounds must be an array." };
  }
  if (rawRounds.length > MAX_ROUNDS) {
    return { ok: false, error: `At most ${MAX_ROUNDS} rounds are allowed.` };
  }

  /** @type {Record<string, unknown>[]} */
  const rounds = [];
  let anyRoundOccurred = false;

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
      anyRoundOccurred = true;
      const type = sanitizeTextField(raw.type, 32).toLowerCase();
      if (!RECRUITMENT_ROUND_TYPES.includes(type)) {
        return {
          ok: false,
          error: `Round ${roundNumber}: select a valid round type.`,
        };
      }
      round.type = type;

      if (type === "other") {
        const otherTypeLabel = sanitizeTextField(raw.otherTypeLabel, MAX_OTHER_LABEL_LEN);
        if (!otherTypeLabel) {
          return {
            ok: false,
            error: `Round ${roundNumber}: describe the round type when "Other" is selected.`,
          };
        }
        round.otherTypeLabel = otherTypeLabel;
      }

      const mode = sanitizeTextField(raw.mode, 16).toLowerCase();
      if (!OA_ASSESSMENT_MODES.includes(mode)) {
        return {
          ok: false,
          error: `Round ${roundNumber}: select online or offline mode.`,
        };
      }
      round.mode = mode;

      const attended = parseNonNegInt(raw.attended);
      const cleared = parseNonNegInt(raw.cleared);
      if (attended == null) {
        return {
          ok: false,
          error: `Round ${roundNumber}: attended count is required.`,
        };
      }
      if (cleared == null) {
        return {
          ok: false,
          error: `Round ${roundNumber}: cleared count is required.`,
        };
      }
      if (cleared > attended) {
        return {
          ok: false,
          error: `Round ${roundNumber}: cleared count cannot exceed attended count.`,
        };
      }
      round.attended = attended;
      round.cleared = cleared;
    }

    rounds.push(round);
  }

  if (!oaOccurred && !anyRoundOccurred) {
    return {
      ok: false,
      error: "At least online assessment or one interview round must be marked as occurred.",
    };
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
