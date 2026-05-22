/**
 * Session-scoped interview question dedupe (source of truth: InterviewSession.rounds).
 * Redis "seen" sets are optional cross-session hints only.
 */

const toSafeString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

/** Normalize question text for duplicate comparison (trim + lowercase). */
export function normalizeInterviewQuestionText(value) {
  return toSafeString(value).toLowerCase();
}

/**
 * Collect every question already used in this interview session.
 * @param {import('../models/InterviewSession.js').default | Record<string, unknown>} session
 * @returns {{ excludedQuestionIds: string[], excludedQuestionTexts: string[] }}
 */
export function collectSessionQuestionExclusions(session) {
  const questionIds = new Set();
  const questionTexts = new Set();

  const rounds = Array.isArray(session?.rounds) ? session.rounds : [];
  for (const round of rounds) {
    const slots = Array.isArray(round?.questions) ? round.questions : [];
    for (const slot of slots) {
      const id = String(slot?.questionId || "").trim();
      if (id) questionIds.add(id);
      const text = normalizeInterviewQuestionText(slot?.question);
      if (text) questionTexts.add(text);
    }
  }

  const liveQuestion = normalizeInterviewQuestionText(session?.currentQuestion);
  if (liveQuestion) questionTexts.add(liveQuestion);

  return {
    excludedQuestionIds: [...questionIds],
    excludedQuestionTexts: [...questionTexts],
  };
}

/**
 * @param {{ question?: string, questionId?: string }} item
 * @param {Set<string>} excludedIdSet
 * @param {Set<string>} excludedTextSet
 */
export function isInterviewQuestionExcluded(item, excludedIdSet, excludedTextSet) {
  const id = toSafeString(item?.questionId);
  const text = normalizeInterviewQuestionText(item?.question);
  if (id && excludedIdSet.has(id)) return true;
  if (text && excludedTextSet.has(text)) return true;
  return false;
}

/**
 * Merge session exclusions with optional extra ids/texts (e.g. from request).
 * @returns {{ excludedQuestionIds: string[], excludedQuestionTexts: string[], excludedIdSet: Set<string>, excludedTextSet: Set<string> }}
 */
export function mergeInterviewQuestionExclusions(
  sessionExclusions,
  { extraQuestionIds = [], extraQuestionTexts = [] } = {}
) {
  const excludedIdSet = new Set();
  const excludedTextSet = new Set();

  for (const id of sessionExclusions?.excludedQuestionIds || []) {
    const safe = toSafeString(id);
    if (safe) excludedIdSet.add(safe);
  }
  for (const id of extraQuestionIds || []) {
    const safe = toSafeString(id);
    if (safe) excludedIdSet.add(safe);
  }

  for (const text of sessionExclusions?.excludedQuestionTexts || []) {
    const safe = normalizeInterviewQuestionText(text);
    if (safe) excludedTextSet.add(safe);
  }
  for (const text of extraQuestionTexts || []) {
    const safe = normalizeInterviewQuestionText(text);
    if (safe) excludedTextSet.add(safe);
  }

  return {
    excludedQuestionIds: [...excludedIdSet],
    excludedQuestionTexts: [...excludedTextSet],
    excludedIdSet,
    excludedTextSet,
  };
}

export default collectSessionQuestionExclusions;
