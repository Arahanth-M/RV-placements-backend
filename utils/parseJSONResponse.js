/**
 * Safely extracts and parses JSON from an LLM response.
 * Handles plain JSON, markdown code fences, and extra surrounding text.
 * @param {string} text
 * @returns {any}
 */
export const parseJSONResponse = (text) => {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("parseJSONResponse requires a non-empty string.");
  }

  const normalized = text.trim();

  // Fast path: response is already valid JSON.
  try {
    return JSON.parse(normalized);
  } catch {
    // Continue with robust extraction.
  }

  // Extract from fenced blocks such as ```json ... ```
  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      // Fall back to scanning mixed text.
    }
  }

  // Scan for the first balanced JSON object/array in free-form text.
  let startIndex = -1;
  let openingChar = "";
  let inString = false;
  let escaped = false;
  const stack = [];

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      if (stack.length === 0) {
        startIndex = i;
        openingChar = char;
      }
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      if (stack.length === 0) {
        continue;
      }

      const last = stack[stack.length - 1];
      const isMatchingPair =
        (last === "{" && char === "}") || (last === "[" && char === "]");

      if (!isMatchingPair) {
        continue;
      }

      stack.pop();

      if (stack.length === 0 && startIndex !== -1) {
        const candidate = normalized.slice(startIndex, i + 1).trim();
        const expectedStart = openingChar;
        if (candidate[0] !== expectedStart) {
          continue;
        }

        try {
          return JSON.parse(candidate);
        } catch {
          // Keep scanning in case a later balanced block is valid JSON.
          startIndex = -1;
          openingChar = "";
        }
      }
    }
  }

  throw new Error("Unable to extract valid JSON from LLM response.");
};

export default parseJSONResponse;

