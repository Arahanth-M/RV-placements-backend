import { normalizeSourceUrl } from "./urlNormalize.js";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_CAP = 20;
const ERROR_TEXT_LIMIT = 180;

export class TavilySearchError extends Error {
  /**
   * @param {string} message
   * @param {{ code: "missing_api_key" | "invalid_query" | "api_failure", status?: number }} details
   */
  constructor(message, details) {
    super(message);
    this.name = "TavilySearchError";
    this.code = details.code;
    if (details.status != null) this.status = details.status;
  }
}

function readApiKey() {
  const key = String(process.env.TAVILY_API_KEY || "").trim();
  if (!key) {
    throw new TavilySearchError("Tavily search failed: TAVILY_API_KEY is not set.", {
      code: "missing_api_key",
    });
  }
  return key;
}

function scrubSecret(text, secret) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!secret || secret.length < 8) return raw.slice(0, ERROR_TEXT_LIMIT);
  return raw.split(secret).join("[redacted]").slice(0, ERROR_TEXT_LIMIT);
}

function asText(value) {
  return value == null ? "" : String(value).trim();
}

/**
 * @param {unknown} payload
 * @returns {Array<{ title: string, url: string, snippet: string, score: number | null }>}
 */
export function normalizeTavilyResults(payload) {
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const seen = new Set();
  const out = [];

  for (const row of rows) {
    const url = asText(row?.url);
    if (!url) continue;
    const key = normalizeSourceUrl(url) || url;
    if (seen.has(key)) continue;
    seen.add(key);

    const score = typeof row?.score === "number" && Number.isFinite(row.score) ? row.score : null;
    out.push({
      title: asText(row?.title),
      url,
      snippet: asText(row?.content),
      score,
    });
  }

  return out;
}

/**
 * @param {string} query
 * @param {{ maxResults?: number, searchDepth?: "basic" | "advanced" }} [options]
 */
export async function searchWeb(query, options = {}) {
  const q = asText(query);
  if (!q) {
    throw new TavilySearchError("Tavily search failed: query is empty.", {
      code: "invalid_query",
    });
  }

  const apiKey = readApiKey();
  let maxResults = DEFAULT_MAX_RESULTS;
  if (options.maxResults != null) {
    const n = Number(options.maxResults);
    if (!Number.isInteger(n) || n < 1) {
      throw new TavilySearchError("Tavily search failed: maxResults must be a positive integer.", {
        code: "invalid_query",
      });
    }
    maxResults = Math.min(n, MAX_RESULTS_CAP);
  }

  const searchDepth = options.searchDepth === "advanced" ? "advanced" : "basic";

  let response;
  try {
    response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: q,
        search_depth: searchDepth,
        include_answer: false,
        max_results: maxResults,
      }),
    });
  } catch (error) {
    throw new TavilySearchError(
      `Tavily search failed: ${scrubSecret(error?.message || "network error", apiKey) || "network error"}.`,
      { code: "api_failure" }
    );
  }

  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    const detail = scrubSecret(bodyText, apiKey);
    throw new TavilySearchError(
      `Tavily search failed: HTTP ${response.status}${detail ? ` ${detail}` : ""}.`,
      { code: "api_failure", status: response.status }
    );
  }

  let payload = {};
  if (bodyText.trim()) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      throw new TavilySearchError("Tavily search failed: response was not JSON.", {
        code: "api_failure",
        status: response.status,
      });
    }
  }

  return normalizeTavilyResults(payload);
}
