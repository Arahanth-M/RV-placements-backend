import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";

const toSafeString = (value, fallback = "") => {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

const truncateText = (value, max = 350) => {
  const safe = toSafeString(value);
  if (!safe) return "";
  if (safe.length <= max) return safe;
  return `${safe.slice(0, max - 3).trimEnd()}...`;
};

const normalizeDifficulty = (value) => {
  const safe = toSafeString(value, "medium").toLowerCase();
  if (safe === "easy" || safe === "medium" || safe === "hard") return safe;
  return "medium";
};

const getAdaptiveFollowUp = ({ hasPreviousAnswer, previousScore, difficulty }) => {
  const baseDifficulty = normalizeDifficulty(difficulty);
  const score = Number(previousScore);

  if (!hasPreviousAnswer || !Number.isFinite(score)) {
    return {
      targetDifficulty: baseDifficulty,
      followUpMode: "opening",
      interviewerIntent: "Ask a strong opening question for this round.",
    };
  }

  if (score >= 8) {
    return {
      targetDifficulty: baseDifficulty === "easy" ? "medium" : "hard",
      followUpMode: "challenge",
      interviewerIntent:
        "Candidate did well. Ask a tougher follow-up with deeper reasoning, edge cases, optimization, or trade-off analysis.",
    };
  }

  if (score <= 4) {
    return {
      targetDifficulty: baseDifficulty === "hard" ? "medium" : "easy",
      followUpMode: "clarify",
      interviewerIntent:
        "Candidate struggled. Ask a clarifying/foundational follow-up that checks core understanding before moving harder.",
    };
  }

  return {
    targetDifficulty: baseDifficulty,
    followUpMode: "steady",
    interviewerIntent:
      "Candidate is average. Ask a related follow-up at similar difficulty to test consistency and practical application.",
  };
};

/**
 * MCP tool: generateQuestion
 * Generates one interview question for the given round context.
 */
export const generateQuestion = async ({
  companyContext,
  roundType,
  roundAbout,
  difficulty,
  previousQuestion,
  previousAnswer,
  previousFeedback,
  previousScore,
  roundHistory = [],
}) => {
  const hasPreviousAnswer = Boolean(toSafeString(previousAnswer));
  const adaptiveFollowUp = getAdaptiveFollowUp({
    hasPreviousAnswer,
    previousScore,
    difficulty,
  });

  const condensedHistory = Array.isArray(roundHistory)
    ? roundHistory
        .slice(-3)
        .map((item, index) => ({
          index: index + 1,
          question: truncateText(item?.question, 180),
          answer: truncateText(item?.answer, 220),
          feedback: truncateText(item?.feedback, 180),
          score:
            Number.isFinite(Number(item?.score)) && Number(item?.score) >= 0
              ? Number(item?.score)
              : null,
        }))
    : [];

  const messages = [
    {
      role: "system",
      content:
        "You are a real interviewer conducting a live interview. Speak naturally like a human interviewer. Return strict JSON only. No markdown or extra text.",
    },
    {
      role: "user",
      content: `You are in the middle of a live interview.

Generate what you would SAY NEXT to the candidate.

Company context: ${JSON.stringify(companyContext || {})}
Round type: ${toSafeString(roundType, "DSA")}
Round focus/topic: ${toSafeString(roundAbout, "General interview")}
Base difficulty: ${normalizeDifficulty(difficulty)}
Target difficulty for this question: ${adaptiveFollowUp.targetDifficulty}
Follow-up mode: ${adaptiveFollowUp.followUpMode}
Interviewer intent: ${adaptiveFollowUp.interviewerIntent}

Has previous answer in this round: ${hasPreviousAnswer ? "yes" : "no"}
Previous question: ${truncateText(previousQuestion, 220)}
Previous answer: ${truncateText(previousAnswer, 320)}
Previous feedback: ${truncateText(previousFeedback, 220)}
Previous score: ${
        Number.isFinite(Number(previousScore)) ? Number(previousScore) : "N/A"
      }

Recent round history: ${JSON.stringify(condensedHistory)}

Rules:
1) Speak like a real interviewer, not like a question generator.
2) Use natural conversational phrasing (e.g., "Can you walk me through...", "What would happen if...", "How would you approach...").
3) If previous answer exists, your question MUST feel like a continuation of the conversation.
4) If previous feedback highlights a gap or mistake, ask a follow-up targeting that gap.
5) Avoid robotic phrasing like "Explain..." or "Describe...".
6) Keep it concise (1–2 sentences max).
7) Do NOT include explanations, only what the interviewer would say.
8) Respect target difficulty and follow-up mode.
9) Avoid repeating the same question or asking something unrelated.

Return JSON:
{
  "question": "string"
}`,
    },
  ];

  const llmText = await callLLM(messages);
  const parsed = parseJSONResponse(llmText);
  const question = toSafeString(parsed?.question);

  if (!question) {
    throw new Error("MCP generateQuestion did not return a valid question.");
  }

  return question;
};

export default generateQuestion;