/**
 * Display-only dates for interview / internship experience cards.
 * Reads Submission timestamps; never writes company_visits or submissions.
 */

function asDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function laterDate(a, b) {
  const left = asDate(a);
  const right = asDate(b);
  if (!left) return right;
  if (!right) return left;
  return left.getTime() >= right.getTime() ? left : right;
}

function toIso(value) {
  const d = asDate(value);
  return d ? d.toISOString() : null;
}

function normalizeNarrative(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parseMaybeJson(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  const text = String(raw).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Visible experience text stored on a visit array entry. */
export function narrativeTextFromStoredEntry(entry) {
  const parsed = parseMaybeJson(entry);
  if (parsed) {
    const nested = parsed.content || parsed.experience || parsed.question;
    if (nested != null && String(nested).trim()) return String(nested).trim();
  }
  return String(entry || "").trim();
}

/** Date already present on the stored JSON (if any). */
export function dateFromStoredEntry(entry) {
  const parsed = parseMaybeJson(entry);
  if (!parsed) return null;
  return laterDate(
    parsed.updatedAt,
    laterDate(parsed.approvedAt, parsed.submittedAt)
  );
}

export function narrativeTextFromSubmission(submission) {
  return narrativeTextFromStoredEntry(submission?.content);
}

export function dateFromSubmission(submission) {
  return laterDate(submission?.approvedAt, submission?.submittedAt);
}

/**
 * @param {unknown[]} entries
 * @param {unknown[]} submissions same type (interviewProcess | internshipExperience)
 * @returns {(string|null)[]} ISO timestamps aligned with `entries`
 */
export function resolveExperienceEntryDates(entries, submissions) {
  const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
  const rows = Array.isArray(submissions) ? submissions : [];

  /** @type {Map<string, Date>} */
  const latestByNarrative = new Map();
  for (const row of rows) {
    const key = normalizeNarrative(narrativeTextFromSubmission(row));
    if (!key) continue;
    const next = dateFromSubmission(row);
    if (!next) continue;
    latestByNarrative.set(key, laterDate(latestByNarrative.get(key), next));
  }

  return list.map((entry) => {
    const fromEntry = dateFromStoredEntry(entry);
    const fromSub = latestByNarrative.get(
      normalizeNarrative(narrativeTextFromStoredEntry(entry))
    );
    return toIso(laterDate(fromEntry, fromSub));
  });
}

/**
 * Attaches parallel date arrays on a company payload copy. Does not mutate visit documents.
 * @param {Record<string, unknown>|null|undefined} companyObj
 * @param {{ interviewProcess?: unknown[], internshipExperience?: unknown[] }} submissionsByType
 */
export function attachExperienceEntryDates(companyObj, submissionsByType = {}) {
  if (!companyObj || typeof companyObj !== "object") return companyObj;
  return {
    ...companyObj,
    interviewProcessUpdatedAt: resolveExperienceEntryDates(
      companyObj.interviewProcess,
      submissionsByType.interviewProcess
    ),
    internshipExperienceUpdatedAt: resolveExperienceEntryDates(
      companyObj.internshipExperience,
      submissionsByType.internshipExperience
    ),
  };
}
