import { callLLM } from "../../services/llmClient.js";
import { testCaseDedupeKey } from "../../utils/dedupeTestCases.js";
import { normalizeExpectedOutput, normalizeTestCaseFields } from "../../utils/normalizeTestCaseExpectedOutput.js";
import { parsePythonParamNames, validateGeneratedHiddenCases } from "./dsaTestCaseLayout.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} text
 * @returns {unknown}
 */
export const extractJsonFromLlmText = (text) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  const tryParse = (candidate) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct != null) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const fromFence = tryParse(fenced[1].trim());
    if (fromFence != null) return fromFence;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = tryParse(trimmed.slice(start, end + 1));
    if (slice != null) return slice;
  }

  const arrStart = trimmed.indexOf("[");
  const arrEnd = trimmed.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    const slice = tryParse(trimmed.slice(arrStart, arrEnd + 1));
    if (slice != null) return slice;
  }

  return null;
};

const formatCasesForPrompt = (cases) =>
  JSON.stringify(
    (cases || []).map((tc) => ({
      input: tc.input,
      expectedOutput: tc.expectedOutput,
    })),
    null,
    2
  );

/**
 * @param {{
 *   title: string,
 *   question: string,
 *   functionSignature: string,
 *   visibleCases: object[],
 *   count: number,
 *   excludeKeys?: Set<string>,
 * }} args
 * @returns {Promise<object[]>}
 */
export const generateHiddenTestCasesWithLlm = async ({
  title,
  question,
  functionSignature,
  visibleCases,
  count = 2,
  excludeKeys = new Set(),
}) => {
  const paramNames = parsePythonParamNames(functionSignature);
  const paramHint =
    paramNames.length > 0
      ? `Each "input" MUST be a JSON object with exactly these keys: ${paramNames.join(", ")}.`
      : `Each "input" MUST be a JSON object matching the Python signature.`;

  const system = `You are a LeetCode-style testcase author. Return ONLY valid JSON (no markdown).
The runner calls the candidate function as target(**input) when input is an object.
expectedOutput must be a JSON value (array, number, string, boolean, or null) — NOT an HTML-encoded string.`;

  const user = `Problem: ${title}
Signature: ${functionSignature}
${paramHint}

Existing sample (visible) test cases — do NOT duplicate these (same input and expectedOutput):
${formatCasesForPrompt(visibleCases)}

Problem statement (truncated):
${String(question || "").slice(0, 4000)}

Generate exactly ${count} NEW hidden edge-case test cases (stress, boundaries, empty/single element, duplicates, overflow-sized within constraints).
Return JSON:
{
  "hiddenCases": [
    { "input": { ... }, "expectedOutput": <json value> }
  ]
}`;

  const content = await callLLM(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.2, max_tokens: 2048 }
  );

  const parsed = extractJsonFromLlmText(content);
  const rawCases = Array.isArray(parsed?.hiddenCases)
    ? parsed.hiddenCases
    : Array.isArray(parsed)
      ? parsed
      : [];

  const normalized = rawCases
    .slice(0, count)
    .map((tc) =>
      normalizeTestCaseFields({
        input: tc?.input,
        expectedOutput: normalizeExpectedOutput(tc?.expectedOutput),
        isHidden: true,
        weight: 1,
      })
    )
    .filter((tc) => tc?.input !== undefined && tc?.expectedOutput !== undefined);

  const validation = validateGeneratedHiddenCases(normalized, paramNames);
  if (!validation.ok) {
    throw new Error(`LLM hidden cases invalid: ${validation.reason}`);
  }

  const visibleKeys = new Set((visibleCases || []).map(testCaseDedupeKey));
  const filtered = normalized.filter((tc) => {
    const key = testCaseDedupeKey(tc);
    if (visibleKeys.has(key)) return false;
    if (excludeKeys.has(key)) return false;
    return true;
  });

  if (filtered.length < count) {
    throw new Error(
      `LLM returned ${filtered.length}/${count} unique hidden cases (duplicates or overlapped visible).`
    );
  }

  return filtered.slice(0, count);
};

export const generateHiddenTestCasesWithRetry = async (args, { retries = 2, delayMs = 400 } = {}) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await generateHiddenTestCasesWithLlm(args);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastError;
};

export default generateHiddenTestCasesWithLlm;
