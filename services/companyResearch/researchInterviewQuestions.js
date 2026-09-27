import { searchWeb } from "./tavilySearch.js";
import { normalizeSourceUrl } from "./urlNormalize.js";
import { extractWebPage } from "./firecrawlExtract.js";
import { structureInterviewQuestions } from "./structureWithGroq.js";

export const DEFAULT_MAX_SOURCES = 3;
export const MAX_SOURCES_CAP = 8;
const PER_QUERY_MAX_RESULTS = 5;

export class ResearchInterviewQuestionsError extends Error {
  /**
   * @param {string} message
   * @param {{ code: "invalid_input" | "search_failed" }} details
   */
  constructor(message, details) {
    super(message);
    this.name = "ResearchInterviewQuestionsError";
    this.code = details.code;
  }
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function quoted(value) {
  return `"${compact(value).replace(/"/g, "")}"`;
}

/**
 * Obvious duplicate questions only. Not semantic similarity.
 * @param {unknown} question
 */
export function normalizeQuestionKey(question) {
  return compact(question)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Small fixed query list. Role and country are included only when present.
 * @param {{ companyName?: string, role?: string, country?: string }} input
 */
export function buildInterviewSearchQueries({ companyName, role, country } = {}) {
  const company = compact(companyName);
  if (!company) {
    throw new ResearchInterviewQuestionsError(
      "Interview research failed: companyName is required.",
      { code: "invalid_input" }
    );
  }
  const roleText = compact(role);
  const countryText = compact(country);
  const subject = roleText ? `${quoted(company)} ${quoted(roleText)}` : quoted(company);
  const queries = [
    `${subject} interview experience questions`,
    `${subject} interview questions`,
    `${subject} technical interview experience`,
  ];
  if (countryText) {
    queries.push(`${subject} interview experience ${countryText}`);
  }
  return queries;
}

function resolveMaxSources(value) {
  if (value == null || value === "") return DEFAULT_MAX_SOURCES;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new ResearchInterviewQuestionsError(
      "Interview research failed: maxSources must be a positive integer.",
      { code: "invalid_input" }
    );
  }
  return Math.min(n, MAX_SOURCES_CAP);
}

function resolveSearchDepth(value) {
  return value === "advanced" ? "advanced" : "basic";
}

function dedupeSources(rows) {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const url = compact(row?.url);
    if (!url) continue;
    const key = normalizeSourceUrl(url) || url;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      title: compact(row?.title),
      url,
      snippet: compact(row?.snippet),
      score: typeof row?.score === "number" && Number.isFinite(row.score) ? row.score : null,
    });
  }
  return unique;
}

function dedupeQuestions(candidates) {
  const byKey = new Map();
  let duplicateCandidates = 0;

  for (const item of candidates) {
    const key = normalizeQuestionKey(item?.question);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        question: item.question,
        kind: item.kind,
        answer: item.answer || "",
        intuition: item.intuition || "",
        evidence: item.evidence,
        sourceUrl: item.sourceUrl,
        sourceTitle: item.sourceTitle || "",
        supportingSources: [],
      });
      continue;
    }
    duplicateCandidates += 1;
    const alreadyListed =
      existing.sourceUrl === item.sourceUrl ||
      existing.supportingSources.some((source) => source.sourceUrl === item.sourceUrl);
    if (!alreadyListed) {
      existing.supportingSources.push({
        sourceUrl: item.sourceUrl,
        sourceTitle: item.sourceTitle || "",
        evidence: item.evidence,
      });
    }
  }

  return { items: [...byKey.values()], duplicateCandidates };
}

/**
 * Synchronous interview-question research. Does not persist anything.
 * @param {{ companyName?: string, role?: string, country?: string, maxSources?: number, searchDepth?: "basic" | "advanced" }} input
 */
export async function researchInterviewQuestions(input = {}) {
  const companyName = compact(input.companyName);
  const role = compact(input.role);
  const country = compact(input.country);
  const queries = buildInterviewSearchQueries({ companyName, role, country });
  const maxSources = resolveMaxSources(input.maxSources);
  const searchDepth = resolveSearchDepth(input.searchDepth);

  const searched = [];
  for (const query of queries) {
    try {
      const rows = await searchWeb(query, {
        maxResults: PER_QUERY_MAX_RESULTS,
        searchDepth,
      });
      searched.push(...(Array.isArray(rows) ? rows : []));
    } catch (error) {
      throw new ResearchInterviewQuestionsError(
        `Interview research failed: Tavily search failed.${error?.code ? ` (${error.code})` : ""}`,
        { code: "search_failed" }
      );
    }
  }

  const unique = dedupeSources(searched);
  const selected = unique.slice(0, maxSources);
  const sources = [];
  const candidates = [];
  let extractedSources = 0;
  let failedExtractions = 0;
  let failedStructures = 0;

  for (const source of selected) {
    let page;
    try {
      page = await extractWebPage(source.url);
    } catch (error) {
      failedExtractions += 1;
      sources.push({
        url: source.url,
        title: source.title,
        tavilyScore: source.score,
        tavilySnippet: source.snippet,
        extractionStatus: "failed",
        structureStatus: "skipped",
        markdownCharCount: null,
        errorCode: compact(error?.code) || "extraction_failed",
      });
      continue;
    }

    extractedSources += 1;
    const markdownCharCount = Number.isInteger(page?.markdownCharCount)
      ? page.markdownCharCount
      : null;
    const sourceTitle = source.title || compact(page?.title);

    try {
      const structured = await structureInterviewQuestions({
        url: source.url,
        title: sourceTitle,
        markdown: typeof page?.markdown === "string" ? page.markdown : "",
      });
      const items = Array.isArray(structured?.items) ? structured.items : [];
      candidates.push(...items);
      sources.push({
        url: source.url,
        title: source.title,
        tavilyScore: source.score,
        tavilySnippet: source.snippet,
        extractionStatus: "extracted",
        structureStatus: "structured",
        markdownCharCount,
        errorCode: null,
      });
    } catch (error) {
      failedStructures += 1;
      sources.push({
        url: source.url,
        title: source.title,
        tavilyScore: source.score,
        tavilySnippet: source.snippet,
        extractionStatus: "extracted",
        structureStatus: "failed",
        markdownCharCount,
        errorCode: compact(error?.code) || "structure_failed",
      });
    }
  }

  const listedUrls = new Set(
    sources.map((entry) => normalizeSourceUrl(entry?.url)).filter(Boolean)
  );
  for (const source of unique) {
    const key = normalizeSourceUrl(source?.url);
    if (!key || listedUrls.has(key)) continue;
    listedUrls.add(key);
    sources.push({
      url: source.url,
      title: source.title,
      tavilyScore: source.score,
      tavilySnippet: source.snippet,
      extractionStatus: "skipped",
      structureStatus: "skipped",
      markdownCharCount: null,
      errorCode: null,
    });
  }

  const { items, duplicateCandidates } = dedupeQuestions(candidates);
  const structuredSources = sources.filter((source) => source.structureStatus === "structured").length;
  let outcome = "ok";
  if (selected.length === 0) outcome = "no_sources";
  else if (structuredSources === 0) outcome = "failed";

  return {
    companyName,
    role,
    country,
    queries,
    outcome,
    sources,
    items,
    stats: {
      searchQueries: queries.length,
      searchedResults: searched.length,
      uniqueSources: unique.length,
      selectedSources: selected.length,
      extractedSources,
      failedSources: failedExtractions + failedStructures,
      extractedCandidates: candidates.length,
      duplicateCandidates,
      finalCandidates: items.length,
    },
  };
}
