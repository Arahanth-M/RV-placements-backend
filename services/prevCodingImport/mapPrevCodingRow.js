import { extractLeetCodeSlugFromUrl, normalizeTitleKey, titleLikeSlug } from "./leetcodeSlug.js";

/**
 * Build a lookup key map from an object's keys (lowercase, spaces removed).
 */
function buildLooseKeyMap(obj) {
  const m = new Map();
  if (!obj || typeof obj !== "object") return m;
  for (const k of Object.keys(obj)) {
    const norm = String(k)
      .toLowerCase()
      .replace(/\s+/g, "");
    if (!m.has(norm)) m.set(norm, k);
  }
  return m;
}

function getViaLooseMap(raw, looseMap, ...candidateNormKeys) {
  for (const cand of candidateNormKeys) {
    const orig = looseMap.get(cand);
    if (!orig) continue;
    const v = raw[orig];
    if (v == null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    return v;
  }
  return undefined;
}

export function parseTopicsValue(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((x) => {
        if (typeof x === "string") return x.split(/[,;/]/);
        if (x && typeof x === "object" && typeof x.name === "string") return [x.name];
        return [];
      })
      .map((s) => String(s).trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;/]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** 0..1 for InterviewQuestion.analytics.successRate, or null if unparsable */
export function parseAcceptanceRate01(value) {
  if (value == null || value === "") return null;
  let n = NaN;
  if (typeof value === "number" && Number.isFinite(value)) n = value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/%/g, "");
    n = parseFloat(cleaned);
  }
  if (!Number.isFinite(n)) return null;
  if (n <= 1 && n >= 0) return Math.min(1, Math.max(0, n));
  if (n > 1 && n <= 100) return Math.min(1, Math.max(0, n / 100));
  return null;
}

/**
 * Normalize one prev_coding_ques element to a stable shape for matching / merging.
 */
export function mapPrevCodingRow(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      title: "",
      link: "",
      linkSlug: "",
      difficulty: "",
      topics: [],
      frequency: "",
      acceptanceRate01: null,
      intuition: "",
      titleKey: "",
      titleSlugGuess: "",
    };
  }

  const loose = buildLooseKeyMap(raw);

  const titleV =
    getViaLooseMap(raw, loose, "title") ??
    raw.Title ??
    raw.title ??
    getViaLooseMap(raw, loose, "problem", "statement", "description");

  const linkV =
    getViaLooseMap(raw, loose, "link", "url", "source") ??
    raw.Link ??
    raw.link ??
    "";

  const title = typeof titleV === "string" ? titleV.trim() : String(titleV || "").trim();
  const link = typeof linkV === "string" ? linkV.trim() : String(linkV || "").trim();

  const diffRaw =
    getViaLooseMap(raw, loose, "difficulty") ?? raw.Difficulty ?? raw.difficulty ?? "";
  const difficulty = String(diffRaw || "")
    .trim()
    .toLowerCase();

  const topics = parseTopicsValue(
    getViaLooseMap(raw, loose, "topics", "topic") ?? raw.Topics ?? raw.topics
  );

  const freqRaw =
    getViaLooseMap(raw, loose, "frequency") ?? raw.Frequency ?? raw.frequency ?? "";
  const frequency = typeof freqRaw === "string" ? freqRaw.trim() : String(freqRaw || "").trim();

  const accRaw =
    getViaLooseMap(raw, loose, "acceptancerate", "acceptance_rate", "acceptance") ??
    raw["Acceptance Rate"];

  const intuitionRaw =
    getViaLooseMap(raw, loose, "intuition") ?? raw.intuition ?? raw.Intuition ?? "";
  const intuition =
    typeof intuitionRaw === "string"
      ? intuitionRaw.replace(/\\n/g, "\n").trim()
      : String(intuitionRaw || "").trim();

  const linkSlug = extractLeetCodeSlugFromUrl(link);

  return {
    title,
    link,
    linkSlug,
    difficulty: difficulty === "easy" || difficulty === "medium" || difficulty === "hard" ? difficulty : "",
    topics,
    frequency,
    acceptanceRate01: parseAcceptanceRate01(accRaw),
    intuition,
    titleKey: normalizeTitleKey(title),
    titleSlugGuess: titleLikeSlug(title),
  };
}

/**
 * Find best seed row for a mapped prev_coding_ques row using indexes.
 * @param {{ bySlug: Map, byNormTitle: Map }} indexes
 * @param {ReturnType<typeof mapPrevCodingRow>} mapped
 */
export function findSeedForMappedRow(indexes, mapped) {
  if (!indexes || !mapped) return null;
  const { bySlug, byNormTitle } = indexes;

  if (mapped.linkSlug) {
    const h = bySlug.get(mapped.linkSlug);
    if (h) return h;
  }
  if (mapped.titleKey) {
    const h = byNormTitle.get(mapped.titleKey);
    if (h) return h;
  }
  if (mapped.titleSlugGuess) {
    const h = bySlug.get(mapped.titleSlugGuess);
    if (h) return h;
  }
  return null;
}
