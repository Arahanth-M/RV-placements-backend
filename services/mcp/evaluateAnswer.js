import cosineSimilarity from "compute-cosine-similarity";
import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";

const TOOL_EVAL_MODEL = process.env.GROQ_TOOL_MODEL || "llama-3.1-8b-instant";

/**
 * Utils
 */
const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const tokenize = (text) =>
  toSafeString(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);

const unique = (arr) => [...new Set(arr)];

const extractReasoningHighlight = (reasoning) => {
  const text = toSafeString(reasoning);
  if (!text) return "";
  const firstSentence = text.split(/[.!?]/)[0]?.trim() || "";
  if (!firstSentence) return "";
  return firstSentence.length > 140
    ? `${firstSentence.slice(0, 137).trimEnd()}...`
    : firstSentence;
};

const buildHumanFeedback = ({
  type,
  finalScore,
  semantic,
  clarity,
  structure,
  wordCount,
  flags,
  reasoningHighlight,
}) => {
  const lines = [];

  if (finalScore >= 8) {
    lines.push("Good answer. This felt confident and interview-ready overall.");
  } else if (finalScore >= 6) {
    lines.push("You're on the right track, and the core idea is there.");
  } else {
    lines.push("I can see your intent, but this would feel incomplete in a real interview.");
  }

  if (type === "coding") {
    if (flags.codePresent) {
      lines.push("I liked that you attempted implementation instead of staying purely theoretical.");
    } else {
      lines.push("For coding rounds, I need to see an actual implementation, not just explanation.");
    }

    if (flags.tooVerbose) {
      lines.push("Keep it tighter: explain approach briefly, then move to clean code and complexity.");
    }
  } else if (type === "system_design") {
    if (flags.hasComponents) {
      lines.push("You covered meaningful system pieces, which is exactly what interviewers look for.");
    } else {
      lines.push("Anchor your design around concrete components like API, storage, cache, and scaling.");
    }

    if (!flags.goodDepth) {
      lines.push("Go one level deeper into trade-offs and failure scenarios to make the design stronger.");
    }
  } else if (type === "behavioral") {
    if (structure >= 0.6) {
      lines.push("Your response had a clear flow, which helps in behavioral interviews.");
    } else {
      lines.push("Use a tighter STAR flow: situation, action you took, and measurable result.");
    }
  }

  if (semantic < 0.45) {
    lines.push("Stay closer to the exact question so your answer feels directly relevant.");
  }
  if (clarity < 0.6) {
    lines.push("Shorter sentences and clearer sequencing would make this easier to follow.");
  }
  if (wordCount < 40) {
    lines.push("Add one concrete example to give more depth and credibility.");
  }

  if (reasoningHighlight) {
    lines.push(`What stood out to me: ${reasoningHighlight}.`);
  }

  return lines.slice(0, 5).join(" ");
};

/**
 * Detect question type
 */
const detectQuestionType = (question) => {
  const q = question.toLowerCase();

  if (/design|architecture|scalable|system/.test(q)) return "system_design";
  if (/tell me about|situation|experience|challenge|conflict/.test(q))
    return "behavioral";
  if (/array|function|return|code|algorithm/.test(q)) return "coding";

  return "general";
};

/**
 * Code detection
 */
const isCodeAnswer = (text) => {
  return /{|}|;|=>|#include|function|return/.test(text);
};

/**
 * Build vector
 */
const buildVector = (tokens, vocab) => {
  const map = new Map();
  tokens.forEach((t) => map.set(t, (map.get(t) || 0) + 1));
  return vocab.map((word) => map.get(word) || 0);
};

/**
 * Structure (STAR)
 */
const detectStructure = (text) => {
  const lower = text.toLowerCase();

  let score = 0;
  if (/situation|context|problem/.test(lower)) score += 0.33;
  if (/action|approach|implemented/.test(lower)) score += 0.34;
  if (/result|impact|outcome/.test(lower)) score += 0.33;

  return score;
};

/**
 * Clarity
 */
const clarityScore = (text) => {
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  const words = text.split(/\s+/).filter(Boolean);

  if (!sentences.length) return 0;

  const avg = words.length / sentences.length;

  if (avg >= 12 && avg <= 20) return 1;
  if (avg >= 8 && avg <= 25) return 0.7;
  return 0.4;
};

/**
 * MAIN FUNCTION
 */
export const evaluateAnswer = async ({
  answer,
  question,
  companyContext,
  llmReasoning,
}) => {
  const safeAnswer = toSafeString(answer);
  const safeQuestion = toSafeString(question);

  const type = detectQuestionType(safeQuestion);

  const answerTokens = tokenize(safeAnswer);
  const questionTokens = tokenize(safeQuestion);
  const reasoningTokens = tokenize(llmReasoning);

  /**
   * Semantic similarity
   */
  const vocab = unique([...answerTokens, ...questionTokens, ...reasoningTokens]);

  const answerVec = buildVector(answerTokens, vocab);
  const refVec = buildVector([...questionTokens, ...reasoningTokens], vocab);

  let semantic = cosineSimilarity(answerVec, refVec) || 0;
  semantic = Math.max(0, Math.min(1, semantic));

  /**
   * Common metrics
   */
  const clarity = clarityScore(safeAnswer);
  const structure = detectStructure(safeAnswer);
  const wordCount = safeAnswer.split(/\s+/).length;
  const reasoningHighlight = extractReasoningHighlight(llmReasoning);

  let score = 0;
  const flags = {
    codePresent: false,
    tooVerbose: false,
    hasComponents: false,
    goodDepth: false,
  };

  /**
   * =========================
   * 🔹 CODING EVALUATION
   * =========================
   */
  if (type === "coding") {
    const codePresent = isCodeAnswer(safeAnswer);
    flags.codePresent = codePresent;

    let codeScore = codePresent ? 1 : 0.3;

    // penalize too much explanation
    if (wordCount > 150) {
      codeScore *= 0.7;
      flags.tooVerbose = true;
    }

    score =
      semantic * 0.3 +
      codeScore * 0.5 +
      clarity * 0.2;

  /**
   * =========================
   * 🔹 SYSTEM DESIGN
   * =========================
   */
  } else if (type === "system_design") {
    const hasComponents = /database|api|cache|load balancer|scaling/.test(
      safeAnswer.toLowerCase()
    );
    flags.hasComponents = hasComponents;

    let depthScore = wordCount > 120 ? 1 : 0.6;
    flags.goodDepth = wordCount > 120;

    score =
      semantic * 0.3 +
      clarity * 0.2 +
      depthScore * 0.3 +
      (hasComponents ? 1 : 0.5) * 0.2;

  /**
   * =========================
   * 🔹 BEHAVIORAL (HR)
   * =========================
   */
  } else if (type === "behavioral") {
    score =
      structure * 0.4 +
      clarity * 0.3 +
      semantic * 0.3;

  /**
   * =========================
   * 🔹 DEFAULT
   * =========================
   */
  } else {
    score = semantic * 0.5 + clarity * 0.5;
  }

  const ruleBasedFinalScore = Math.max(1, Math.min(10, Math.round(score * 10)));
  const ruleBasedFeedback = buildHumanFeedback({
    type,
    finalScore: ruleBasedFinalScore,
    semantic,
    clarity,
    structure,
    wordCount,
    flags,
    reasoningHighlight,
  });

  let adjustedScore = score;
  let llmVerdict = "partial";
  let llmInsight = "";
  let llmImprovement = "";

  try {
    const llmEvalRaw = await callLLM(
      [
        {
          role: "system",
          content:
            "You are a strict but fair technical interviewer. Evaluate answers like a real interviewer.",
        },
        {
          role: "user",
          content: `Question: ${safeQuestion}
Candidate Answer: ${safeAnswer}
Reference reasoning: ${toSafeString(llmReasoning)}

Evaluate the answer.

Return STRICT JSON:
{
  "verdict": "correct | partial | incorrect",
  "insight": "What is good or wrong in the answer",
  "improvement": "One clear actionable suggestion"
}`,
        },
      ],
      { model: TOOL_EVAL_MODEL }
    );

    const parsedEval = parseJSONResponse(llmEvalRaw);
    const verdictCandidate = toSafeString(parsedEval?.verdict).toLowerCase();
    if (
      verdictCandidate === "correct" ||
      verdictCandidate === "partial" ||
      verdictCandidate === "incorrect"
    ) {
      llmVerdict = verdictCandidate;
    }
    llmInsight = toSafeString(parsedEval?.insight);
    llmImprovement = toSafeString(parsedEval?.improvement);
  } catch (error) {
    // Keep evaluator resilient: rule-based path is always available.
  }

  if (llmVerdict === "correct") adjustedScore += 0.1;
  if (llmVerdict === "incorrect") adjustedScore -= 0.2;

  const finalScore = Math.max(1, Math.min(10, Math.round(adjustedScore * 10)));
  const feedbackParts = [ruleBasedFeedback];
  if (llmInsight) feedbackParts.push(llmInsight);
  if (llmImprovement) feedbackParts.push(`Suggestion: ${llmImprovement}`);
  const feedback = feedbackParts.join("\n\n").slice(0, 1200);

  return {
    score: finalScore,
    type,
    feedback,
    verdict: llmVerdict,
  };
};

export default evaluateAnswer;