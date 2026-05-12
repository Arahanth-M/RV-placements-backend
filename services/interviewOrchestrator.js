/**
 * Decide the next interview action based on current session progress.
 *
 * NOTE:
 * - This orchestrator is decision-only.
 * - It does not write to DB or call external services.
 * - `evaluationResult` is accepted for future extension, but currently unused.
 */
export async function handleEvaluationResult(session, evaluationResult) {
  // Reserved for future policy logic (quality gates, retry branches, etc.).
  void evaluationResult;

  // 1) Extract and validate the rounds collection.
  const rounds = Array.isArray(session?.rounds) ? session.rounds : null;
  if (!rounds || rounds.length === 0) {
    throw new Error("Interview session is missing rounds.");
  }

  // 2) Resolve current round and question indexes.
  const currentRoundNumber = Number(session?.currentRound) || 1; // 1-based
  const currentRoundIndex = Math.max(0, currentRoundNumber - 1); // 0-based
  const currentRound = rounds[currentRoundIndex];
  if (!currentRound) {
    throw new Error("Current round could not be resolved from session.");
  }

  const questions = Array.isArray(currentRound?.questions)
    ? currentRound.questions
    : [];
  const currentQuestionIndex = Number(session?.currentQuestionIndex) || 0; // 0-based

  // 3) Compute progression flags with safe index checks.
  const roundTypeLabel = String(currentRound?.type || "").trim();
  const isDsaRound = roundTypeLabel.toUpperCase() === "DSA";
  const rawPlanned = Math.max(
    1,
    Number(currentRound?.questionCount) || questions.length || 1
  );
  const plannedQuestionCount = isDsaRound ? Math.min(3, rawPlanned) : rawPlanned;
  const hasNextQuestion = currentQuestionIndex < plannedQuestionCount - 1;
  const isLastRound = currentRoundIndex >= rounds.length - 1;

  // 4) Decide next action without mutating state.
  if (hasNextQuestion) {
    return {
      action: "NEXT_QUESTION",
      meta: { hasNextQuestion },
    };
  }

  if (!isLastRound) {
    return {
      action: "NEXT_ROUND",
      meta: { hasNextQuestion },
    };
  }

  return {
    action: "INTERVIEW_COMPLETE",
    meta: { hasNextQuestion },
  };
}

