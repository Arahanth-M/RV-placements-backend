/**
 * Optional web enrichment when campus interview experiences are missing
 * (unless must-do topics alone are already rich: > 10).
 * Uses Tavily when TAVILY_API_KEY is set; otherwise returns empty (LLM uses careful general knowledge).
 * Never writes to Mongo.
 */

const ALLOWED_HOST_FRAGMENTS = [
  "leetcode.com",
  "geeksforgeeks.org",
  "interviewbit.com",
  "careercup.com",
  "glassdoor.com",
  "levels.fyi",
  "wikipedia.org",
  "github.com",
  "medium.com",
  "dev.to",
];

function hostAllowed(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWED_HOST_FRAGMENTS.some((frag) => host === frag || host.endsWith(`.${frag}`));
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<{ snippets: string[], sources: Array<{title:string,url:string,kind:string}>, webAugmented: boolean }>}
 */
export async function fetchPrepWebSnippets({ companyName, role, track }) {
  const apiKey = String(process.env.TAVILY_API_KEY || "").trim();
  if (!apiKey) {
    return { snippets: [], sources: [], webAugmented: false };
  }

  const trackHint =
    String(track) === "summer_internship"
      ? "summer internship"
      : "full time campus placement";
  const query = `${companyName} ${role || "software engineer"} ${trackHint} interview preparation OA coding questions`;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        include_answer: false,
        max_results: 2,
      }),
    });
    if (!res.ok) {
      console.warn("[prepPath] tavily non-OK", res.status);
      return { snippets: [], sources: [], webAugmented: false };
    }
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const snippets = [];
    const sources = [];
    for (const row of results) {
      const url = String(row?.url || "").trim();
      if (!url || !hostAllowed(url)) continue;
      const title = String(row?.title || url).trim().slice(0, 200);
      const content = String(row?.content || "").trim().slice(0, 200);
      if (content) snippets.push(`${title}: ${content}`);
      sources.push({ title, url, kind: "web" });
    }
    return {
      snippets: snippets.slice(0, 2),
      sources: sources.slice(0, 2),
      webAugmented: snippets.length > 0,
    };
  } catch (err) {
    console.warn("[prepPath] web search failed", err?.message || err);
    return { snippets: [], sources: [], webAugmented: false };
  }
}
