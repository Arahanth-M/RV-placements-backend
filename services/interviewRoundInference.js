/**
 * Deterministic interview round inference: parse interviewProcess into rounds,
 * score evidence for HR vs system-design vs DSA, and normalize planner output.
 * LLM suggestions are layered on top and validated against this evidence.
 */

const toSafeString = (value) => {
  return typeof value === "string" ? value.trim() : "";
};

export const normalizeInterviewProcess = (value) => {
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

export const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        return toSafeString(item.question || item.content || item.title);
      }
      return "";
    })
    .filter(Boolean);
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

/** Strong system-design phrases only (avoid bare "design" / "architecture"). */
const SYSTEM_DESIGN_HINT_PATTERNS = [
  /\bsystem\s+design\b/i,
  /\bhigh[\s-]?level\s+design\b/i,
  /\bhld\b/i,
  /\blow[\s-]?level\s+design\b/i,
  /\b(?:design|architect)\s+(?:a|an|the)\s+(?:system|service|platform|api)\b/i,
  /\bmicroservices?\s+(?:architecture|design)\b/i,
  /\bdistributed\s+(?:system\s+)?(?:design|architecture)\b/i,
  /\bscalable\s+(?:architecture|backend|service)\b/i,
];

const HR_HINT_PATTERNS = [
  /\bbehavior(?:al)?\b/i,
  /\bhr\b/i,
  /\bstar\b/i,
  /\bmanagerial\b/i,
  /\bculture\s+fit\b/i,
  /\btell\s+me\s+about\b/i,
  /\bstrengths?\s+and\s+weaknesses\b/i,
  /\bfinal\s+(?:hr|human)\b/i,
  /\bwhy\s+(?:this\s+)?(?:company|bank|firm|role)\b/i,
];

function countPatternHits(text, patterns) {
  const safe = toSafeString(text);
  if (!safe) return 0;
  let n = 0;
  for (const re of patterns) {
    if (re.test(safe)) n += 1;
  }
  return n;
}

/**
 * Corpus-level: allow System Design rounds only when something in process/questions suggests it.
 */
export function buildInterviewRoundEvidence(companyData) {
  const processItems = normalizeInterviewProcess(
    companyData?.interviewProcess || companyData?.interview_process
  );
  const onlineQuestions = normalizeStringArray(
    companyData?.onlineQuestions || companyData?.online_questions
  );
  const interviewQuestions = normalizeStringArray(
    companyData?.interviewQuestions || companyData?.interview_questions
  );

  const processText = processItems.join("\n");
  const chunks = [
    processText,
    ...onlineQuestions.slice(0, 30),
    ...interviewQuestions.slice(0, 30),
  ];
  const corpusText = chunks.join("\n");

  const sdHits = countPatternHits(corpusText, SYSTEM_DESIGN_HINT_PATTERNS);
  const hrHits = countPatternHits(corpusText, HR_HINT_PATTERNS);

  return {
    processText,
    corpusText,
    systemDesignHits: sdHits,
    hrHits,
    /** Require at least one strong SD signal somewhere before labeling any round System Design. */
    systemDesignAllowed: sdHits >= 1,
  };
}

export function hintAllowsSystemDesign(hintText) {
  return countPatternHits(hintText, SYSTEM_DESIGN_HINT_PATTERNS) >= 1;
}

export function hintLooksHr(hintText) {
  return countPatternHits(hintText, HR_HINT_PATTERNS) >= 1;
}

/**
 * Classify a single round from process hint text + optional global evidence gate for SD.
 */
export function classifyRoundTypeFromHint(hintText, evidence) {
  const gateSd = evidence?.systemDesignAllowed !== false;

  if (hintLooksHr(hintText)) {
    return "HR";
  }

  if (hintAllowsSystemDesign(hintText)) {
    return gateSd ? "System Design" : "DSA";
  }

  return "DSA";
}

/**
 * Normalize strings from AI planner into canonical round types (stricter than substring checks).
 */
export function normalizePlannerRoundType(value) {
  const raw = toSafeString(value).toLowerCase().replace(/_/g, " ");
  if (!raw) return "DSA";

  if (/\bhr\b|\bbehavior|\bmanagerial|\bculture\b/.test(raw)) {
    return "HR";
  }

  if (
    /\bsystem\s+design\b/.test(raw) ||
    /\bhld\b/.test(raw) ||
    /\bhigh\s+level\s+design\b/.test(raw) ||
    /\blow\s+level\s+design\b/.test(raw)
  ) {
    return "System Design";
  }

  return "DSA";
}

/**
 * After merging AI + fallback, enforce evidence: strip System Design when unsupported.
 */
export function constrainRoundType(type, hintText, evidence, fallbackType) {
  const canonical =
    type === "HR" || type === "System Design" || type === "DSA" ? type : normalizePlannerRoundType(type);

  if (canonical === "System Design") {
    const hintOk = hintAllowsSystemDesign(hintText);
    const corpusOk = evidence?.systemDesignAllowed;
    if (!hintOk && !corpusOk) {
      return fallbackType === "HR" ? "HR" : "DSA";
    }
  }

  return canonical;
}

const extractNumberedRoundSegments = (text) => {
  const safeText = toSafeString(text);
  if (!safeText) return [];

  const matches = [];
  const regex = /\b(?:round|rnd)\s*(\d+)\s*[\):\-]?/gi;
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

/** Split one blob into segments at "Round 2"-style boundaries (same line OK). */
function splitAtRoundBoundaries(text) {
  const safe = toSafeString(text);
  if (!safe) return [];

  const parts = safe.split(/\s+(?=\b(?:Round|Rnd)\s*\d+\b)/gi).map((s) => s.trim()).filter(Boolean);

  return parts.length > 1 ? parts : [];
}

/** Split "1. Foo 2. Bar" style enumerations on one line. */
function splitEnumeratedSegments(text) {
  const safe = toSafeString(text);
  if (!safe) return [];

  const parts = safe.split(/\s+(?=\d{1,2}\.\s+)/g).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return [];

  const filtered = parts.filter((p) => /^\d{1,2}\.\s+/.test(p));
  return filtered.length >= 2 ? filtered : [];
}

/** Split long single-line processes on semicolons when it yields multiple substantive chunks. */
function splitSemicolonSegments(text) {
  const safe = toSafeString(text);
  if (safe.length < 40 || !safe.includes(";")) return [];

  const parts = safe.split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return [];

  const substantive = parts.filter((p) => p.split(/\s+/).length >= 2);
  return substantive.length >= 2 ? substantive : [];
}

/**
 * Parse normalized process items into ordered round hints (deterministic).
 */
export function parseInterviewProcessToRoundHints(processItems) {
  const items = Array.isArray(processItems) ? processItems.filter(Boolean) : [];

  if (items.length === 0) {
    return { roundHints: [], roundSegments: [], source: "empty" };
  }

  const combinedProcessText = items.join("\n");
  const numberedSegments = extractNumberedRoundSegments(combinedProcessText);
  if (numberedSegments.length > 0) {
    const numberedHints = numberedSegments.map((segment, index) => ({
      roundNumber: index + 1,
      about: summarizeRoundSegment(segment, `Round ${index + 1}`),
    }));
    return {
      roundHints: numberedHints,
      roundSegments: numberedHints.map((h) => h.about),
      source: "interviewProcess.numbered",
    };
  }

  const flattenedProcessItems = items.flatMap((item) => splitRoundLikeLines(item));
  let roundLikeItems =
    flattenedProcessItems.length > 1 ? flattenedProcessItems : [...items];

  if (roundLikeItems.length <= 1 && roundLikeItems[0]) {
    const blob = roundLikeItems[0];
    const byBoundary = splitAtRoundBoundaries(blob);
    if (byBoundary.length > 1) {
      roundLikeItems = byBoundary;
    } else {
      const enumerated = splitEnumeratedSegments(blob);
      if (enumerated.length > 1) {
        roundLikeItems = enumerated;
      } else {
        const semi = splitSemicolonSegments(blob);
        if (semi.length > 1) {
          roundLikeItems = semi;
        }
      }
    }
  }

  const listHints = roundLikeItems.map((item, index) => ({
    roundNumber: index + 1,
    about: summarizeRoundSegment(item, `Round ${index + 1}`),
  }));

  return {
    roundHints: listHints,
    roundSegments: listHints.map((h) => h.about),
    source: "interviewProcess.list",
  };
}
