import { searchWeb } from "./tavilySearch.js";
import { normalizeSourceUrl } from "./urlNormalize.js";
import { extractWebPage } from "./firecrawlExtract.js";

const PER_QUERY_MAX_RESULTS = 5;

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Obvious duplicate text only. Not semantic similarity.
 * @param {unknown} question
 */
export function normalizeQuestionKey(question) {
  return compact(question)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

/**
 * Dedupe candidates by normalized text. Keeps the first wording and lists later sources.
 * @param {unknown[]} candidates
 * @param {(item: unknown) => string} textOf
 */
export function dedupeByText(candidates, textOf) {
  const byKey = new Map();
  let duplicateCandidates = 0;

  for (const item of candidates) {
    const key = normalizeQuestionKey(textOf(item));
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...item, supportingSources: [] });
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
 * Search, extract, and structure a bounded set of pages.
 * Does not persist anything.
 * @param {{
 *   companyName: string,
 *   role: string,
 *   country: string,
 *   queries: string[],
 *   maxSources: number,
 *   searchDepth: "basic" | "advanced",
 *   structurePage: (source: { url: string, title: string, markdown: string }) => Promise<{ items?: unknown[] }>,
 *   textOf: (item: unknown) => string,
 *   failurePrefix: string,
 *   ErrorClass: new (message: string, details: { code: "invalid_input" | "search_failed" }) => Error,
 * }} input
 */
export async function researchSourcedContent(input) {
  const companyName = compact(input.companyName);
  const role = compact(input.role);
  const country = compact(input.country);
  const queries = input.queries;
  const maxSources = input.maxSources;
  const searchDepth = input.searchDepth === "advanced" ? "advanced" : "basic";
  const { structurePage, textOf, failurePrefix, ErrorClass } = input;

  const searched = [];
  for (const query of queries) {
    try {
      const rows = await searchWeb(query, {
        maxResults: PER_QUERY_MAX_RESULTS,
        searchDepth,
      });
      searched.push(...(Array.isArray(rows) ? rows : []));
    } catch (error) {
      throw new ErrorClass(
        `${failurePrefix}: Tavily search failed.${error?.code ? ` (${error.code})` : ""}`,
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
      const structured = await structurePage({
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

  const { items, duplicateCandidates } = dedupeByText(candidates, textOf);
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
