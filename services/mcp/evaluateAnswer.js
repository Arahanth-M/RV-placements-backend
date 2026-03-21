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

const unique = (arr) => [...new Set(arr)];

/**
 * MCP tool: evaluateAnswer
 * Backend-controlled scoring using deterministic heuristics (no LLM scoring).
 */
export const evaluateAnswer = async ({
  answer,
  question,
  companyContext,
  llmReasoning,
}) => {
  const safeAnswer = toSafeString(answer);
  const safeQuestion = toSafeString(question);

  const answerTokens = unique(tokenize(safeAnswer));
  const questionTokens = unique(tokenize(safeQuestion));
  const contextTokens = unique(
    tokenize(
      [
        ...(companyContext?.mustDoTopics || []),
        ...(companyContext?.onlineQuestions || []),
        ...(companyContext?.interviewQuestions || []),
      ]
        .slice(0, 12)
        .join(" ")
    )
  );
  const reasoningTokens = unique(tokenize(llmReasoning)).slice(0, 40);

  const referenceSet = new Set([
    ...questionTokens,
    ...contextTokens.slice(0, 40),
    ...reasoningTokens,
  ]);

  let overlap = 0;
  answerTokens.forEach((token) => {
    if (referenceSet.has(token)) overlap += 1;
  });

  const answerWordCount = safeAnswer.split(/\s+/).filter(Boolean).length;
  const coverageRatio =
    referenceSet.size > 0 ? Math.min(1, overlap / Math.max(8, referenceSet.size * 0.4)) : 0;

  const lengthScore =
    answerWordCount >= 120 ? 1 : answerWordCount >= 70 ? 0.85 : answerWordCount >= 35 ? 0.65 : 0.4;

  const weighted = coverageRatio * 0.65 + lengthScore * 0.35;
  const score = Math.max(1, Math.min(10, Math.round(weighted * 10)));

  const feedbackParts = [];
  if (score >= 8) {
    feedbackParts.push("Strong answer with good coverage and structure.");
  } else if (score >= 6) {
    feedbackParts.push("Decent answer, but it can be sharper and more complete.");
  } else {
    feedbackParts.push("Answer needs more depth and clearer technical reasoning.");
  }

  if (answerWordCount < 40) {
    feedbackParts.push("Try giving a more detailed and step-by-step explanation.");
  }

  if (coverageRatio < 0.45) {
    feedbackParts.push("Connect your response more closely to the actual question requirements.");
  }

  const reasoningSummary = toSafeString(llmReasoning).slice(0, 280);
  if (reasoningSummary) {
    feedbackParts.push(`Reasoning note: ${reasoningSummary}`);
  }

  return {
    score,
    feedback: feedbackParts.join(" "),
  };
};

export default evaluateAnswer;

