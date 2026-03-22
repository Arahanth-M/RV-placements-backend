const toSafeString = (value) => {
  return typeof value === "string" ? value.trim() : "";
};

const splitRoundLikeLines = (value) => {
  const safe = toSafeString(value);
  if (!safe) return [];

  return safe
    .split(/\n+|(?:\s*->\s*)/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const summarizeRoundSegment = (value, fallbackText) => {
  const raw = toSafeString(value);
  if (!raw) return fallbackText;

  const cleaned = raw
    .replace(/^round\s*\d+\s*[:\-]?\s*/i, "")
    .replace(/^[\)\]\-:\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return fallbackText;

  let summary = cleaned.split(/[;|.]/)[0].trim() || cleaned;
  const words = summary.split(" ").filter(Boolean);
  if (words.length > 12) {
    summary = `${words.slice(0, 12).join(" ")}...`;
  }
  if (summary.length > 80) {
    summary = `${summary.slice(0, 77).trimEnd()}...`;
  }

  return summary || fallbackText;
};

const normalizeInterviewProcess = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          return toSafeString(item.round || item.title || item.name || item.content);
        }
        return "";
      })
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
};

const extractNumberedRoundSegments = (text) => {
  const safeText = toSafeString(text);
  if (!safeText) return [];

  const matches = [];
  const regex = /\bround\s*(\d+)\s*[\):\-]?/gi;
  let match;

  while ((match = regex.exec(safeText)) !== null) {
    matches.push({
      number: Number(match[1]),
      index: match.index,
    });
  }

  if (matches.length === 0) {
    return [];
  }

  const uniqueNumbers = new Set(matches.map((item) => item.number).filter(Number.isFinite));
  const orderedUniqueMatches = [];
  const seen = new Set();
  for (const item of matches) {
    if (!seen.has(item.number)) {
      seen.add(item.number);
      orderedUniqueMatches.push(item);
    }
  }

  const segments = orderedUniqueMatches.map((current, index) => {
    const next = orderedUniqueMatches[index + 1];
    const endIndex = next ? next.index : safeText.length;
    return safeText.slice(current.index, endIndex).trim();
  });

  if (segments.length === uniqueNumbers.size) {
    return segments;
  }

  return [];
};

/**
 * MCP tool: getNumberOfRounds
 * Responsibility: determine total rounds from company interviewProcess.
 * Fallback: if no interviewProcess is available, default to 3 rounds.
 */
export const getNumberOfRounds = async (companyData) => {
  const processItems = normalizeInterviewProcess(
    companyData?.interviewProcess || companyData?.interview_process
  );

  if (processItems.length === 0) {
    const defaultHints = Array.from({ length: 3 }, (_, index) => ({
      roundNumber: index + 1,
      about: `Round ${index + 1}`,
    }));
    return {
      totalRounds: 3,
      roundSegments: [],
      roundHints: defaultHints,
      source: "default",
    };
  }

  const combinedProcessText = processItems.join("\n");
  const numberedSegments = extractNumberedRoundSegments(combinedProcessText);
  if (numberedSegments.length > 0) {
    const numberedHints = numberedSegments.map((segment, index) => ({
      roundNumber: index + 1,
      about: summarizeRoundSegment(segment, `Round ${index + 1}`),
    }));
    return {
      totalRounds: numberedSegments.length,
      roundSegments: numberedHints.map((hint) => hint.about),
      roundHints: numberedHints,
      source: "interviewProcess.numbered",
    };
  }

  const flattenedProcessItems = processItems.flatMap((item) => splitRoundLikeLines(item));
  const roundLikeItems =
    flattenedProcessItems.length > 1 ? flattenedProcessItems : processItems;

  const listHints = roundLikeItems.map((item, index) => ({
    roundNumber: index + 1,
    about: summarizeRoundSegment(item, `Round ${index + 1}`),
  }));

  return {
    totalRounds: listHints.length,
    roundSegments: listHints.map((hint) => hint.about),
    roundHints: listHints,
    source: "interviewProcess.list",
  };
};

export default getNumberOfRounds;
