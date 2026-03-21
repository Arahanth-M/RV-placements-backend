const toSafeString = (value, fallback = "") => {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

const tokenize = (text) => {
  return toSafeString(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
};

const unique = (items) => [...new Set(items)];

/**
 * MCP tool: generateRoundFeedback
 * Aggregates per-question performance into structured round feedback.
 * This tool does NOT call LLM directly.
 */
export const generateRoundFeedback = async ({ roundData, companyContext }) => {
  const round = roundData || {};
  const questions = Array.isArray(round?.questions) ? round.questions : [];
  const answered = questions.filter((q) => toSafeString(q?.answer));
  const scores = answered
    .map((q) => Number(q?.score))
    .filter((score) => Number.isFinite(score));

  const avgScore =
    scores.length > 0
      ? Math.round((scores.reduce((acc, score) => acc + score, 0) / scores.length) * 10) / 10
      : 0;

  const contextTokens = unique(
    tokenize(
      [
        ...(companyContext?.mustDoTopics || []),
        ...(companyContext?.onlineQuestions || []),
        ...(companyContext?.interviewQuestions || []),
      ]
        .slice(0, 20)
        .join(" ")
    )
  );

  const answerTokens = unique(answered.flatMap((q) => tokenize(q?.answer)));
  let contextCoverage = 0;
  if (contextTokens.length > 0) {
    const ctxSet = new Set(contextTokens);
    answerTokens.forEach((token) => {
      if (ctxSet.has(token)) contextCoverage += 1;
    });
  }
  const contextCoverageRatio =
    contextTokens.length > 0
      ? Math.min(1, contextCoverage / Math.max(10, contextTokens.length * 0.25))
      : 0;

  const strengths = [];
  const weaknesses = [];
  const improvementTips = [];

  if (avgScore >= 8) {
    strengths.push("Strong understanding of concepts for this round.");
  } else if (avgScore >= 6) {
    strengths.push("Reasonable baseline understanding of round topics.");
    weaknesses.push("Needs more depth and clearer technical articulation.");
  } else {
    weaknesses.push("Core concepts need stronger clarity and detail.");
  }

  if (answered.length < questions.length) {
    weaknesses.push("Some questions were left unanswered or partially answered.");
  }

  if (contextCoverageRatio >= 0.55) {
    strengths.push("Good alignment with company-focused topics.");
  } else if (answered.length > 0) {
    weaknesses.push("Answers can be aligned better with company-specific focus areas.");
  }

  const summary = `Round ${round?.roundNumber || "-"} (${toSafeString(
    round?.type,
    "General"
  )}) completed with average score ${avgScore}/10 across ${answered.length} answered questions.`;

  if (avgScore < 6) {
    improvementTips.push("Practice structured problem solving and explain your approach step by step.");
  }
  if (avgScore < 8) {
    improvementTips.push("Improve precision by covering edge cases and trade-offs explicitly.");
  } else {
    improvementTips.push("Maintain this level by practicing timed mock questions.");
  }

  return {
    summary,
    strengths: unique(strengths),
    weaknesses: unique(weaknesses),
    improvementTips,
  };
};

export default generateRoundFeedback;

