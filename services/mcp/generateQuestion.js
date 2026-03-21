import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";

const toSafeString = (value, fallback = "") => {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

/**
 * MCP tool: generateQuestion
 * Generates one interview question for the given round context.
 */
export const generateQuestion = async ({
  companyContext,
  roundType,
  difficulty,
}) => {
  const messages = [
    {
      role: "system",
      content: "Return strict JSON only. No markdown or extra text.",
    },
    {
      role: "user",
      content: `Generate one interview question for this round.
The question should align with company pattern and be phrased naturally.

Company context: ${JSON.stringify(companyContext || {})}
Round type: ${toSafeString(roundType, "DSA")}
Difficulty: ${toSafeString(difficulty, "medium")}

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

