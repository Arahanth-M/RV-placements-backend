/**
 * Per-question submission history for mock interviews (initial + optional single reattempt).
 */

export function mirrorLegacyAttemptsIntoSlot(slot) {
  if (!slot || typeof slot !== "object") return false;
  if (!Array.isArray(slot.attempts)) slot.attempts = [];
  if (slot.attempts.length > 0) return false;
  const a = slot.answer;
  if (
    typeof a === "string" &&
    a.trim() !== "" &&
    slot.score != null &&
    Number.isFinite(Number(slot.score))
  ) {
    slot.attempts.push({
      answer: a,
      score: Number(slot.score),
      feedback: typeof slot.feedback === "string" ? slot.feedback : "",
      evaluationTrace: slot.evaluationTrace ?? null,
    });
    return true;
  }
  return false;
}

export function normalizedQuestionAttempts(slot) {
  if (!slot || typeof slot !== "object") return [];
  const raw = Array.isArray(slot.attempts) ? slot.attempts : [];
  if (raw.length > 0) return raw;
  const a = slot.answer;
  if (
    typeof a === "string" &&
    a.trim() !== "" &&
    slot.score != null &&
    Number.isFinite(Number(slot.score))
  ) {
    return [
      {
        answer: a,
        score: Number(slot.score),
        feedback: typeof slot.feedback === "string" ? slot.feedback : "",
        evaluationTrace: slot.evaluationTrace ?? null,
      },
    ];
  }
  return [];
}

/** User cleared working fields after first graded attempt and is composing a single reattempt. */
export function isQuestionRetryPendingSlot(slot) {
  const attempts = normalizedQuestionAttempts(slot);
  const ans = typeof slot?.answer === "string" ? slot.answer.trim() : "";
  return attempts.length >= 1 && ans === "";
}

/** Numeric score for a question slot: prefers root `score`, else best score among `attempts`. */
export function resolvedQuestionScore(question) {
  if (!question || typeof question !== "object") return null;
  const root = Number(question.score);
  let best = Number.isFinite(root) ? root : null;
  const attempts = Array.isArray(question.attempts) ? question.attempts : [];
  for (const t of attempts) {
    const n = Number(t?.score);
    if (Number.isFinite(n)) best = best == null ? n : Math.max(best, n);
  }
  return best;
}

/** Answer text: live slot answer, else latest attempt with non-empty answer. */
export function resolvedQuestionAnswer(question) {
  if (!question || typeof question !== "object") return "";
  const direct = question.answer;
  if (typeof direct === "string" && direct.trim() !== "") return direct.trim();
  const attempts = Array.isArray(question.attempts) ? question.attempts : [];
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i]?.answer;
    if (typeof a === "string" && a.trim() !== "") return a.trim();
  }
  return "";
}

/** Slot counts if there is stored prose/code or at least one graded score. */
export function questionSlotHasInterviewPayload(question) {
  return (
    resolvedQuestionAnswer(question).length > 0 || resolvedQuestionScore(question) != null
  );
}
