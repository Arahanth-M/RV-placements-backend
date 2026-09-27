const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const ERROR_TEXT_LIMIT = 180;

export class FirecrawlExtractError extends Error {
  /**
   * @param {string} message
   * @param {{ code: "missing_api_key" | "invalid_url" | "api_failure", url?: string, status?: number }} details
   */
  constructor(message, details) {
    super(message);
    this.name = "FirecrawlExtractError";
    this.code = details.code;
    if (details.url) this.url = details.url;
    if (details.status != null) this.status = details.status;
  }
}

function readApiKey() {
  const key = String(process.env.FIRECRAWL_API_KEY || "").trim();
  if (!key) {
    throw new FirecrawlExtractError("Firecrawl extraction failed: FIRECRAWL_API_KEY is not set.", {
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

function scrubValue(value, secret) {
  if (!secret || secret.length < 8) return value;
  if (typeof value === "string") return value.split(secret).join("[redacted]");
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, secret));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = scrubValue(item, secret);
    }
    return out;
  }
  return value;
}

/**
 * @param {unknown} raw
 * @returns {string | null} trimmed http(s) URL, or null
 */
export function usableWebUrl(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return null;
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  return input;
}

/**
 * @param {unknown} payload
 * @param {string} requestedUrl
 * @param {string} [secret]
 */
export function normalizeFirecrawlPayload(payload, requestedUrl, secret = "") {
  const data =
    payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? payload.data
      : payload;
  const markdownRaw = data?.markdown;
  const markdown =
    typeof markdownRaw === "string" && markdownRaw.trim() ? markdownRaw : "";
  const metadata =
    data?.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? scrubValue(data.metadata, secret)
      : null;
  const titleRaw = metadata && typeof metadata.title === "string" ? metadata.title.trim() : "";

  return {
    url: requestedUrl,
    title: titleRaw || null,
    markdown: typeof markdown === "string" ? scrubValue(markdown, secret) : "",
    metadata,
    markdownCharCount: markdown.length,
  };
}

/**
 * Extract readable page text. Empty markdown is a successful result.
 * Invalid URLs and API failures throw FirecrawlExtractError.
 * @param {string} url
 */
export async function extractWebPage(url) {
  const requestedUrl = usableWebUrl(url);
  if (!requestedUrl) {
    throw new FirecrawlExtractError("Firecrawl extraction failed: URL is not a usable http(s) URL.", {
      code: "invalid_url",
      url: String(url ?? "").trim().slice(0, 300),
    });
  }

  const apiKey = readApiKey();

  let response;
  try {
    response = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: requestedUrl,
        formats: ["markdown"],
      }),
    });
  } catch (error) {
    throw new FirecrawlExtractError(
      `Firecrawl extraction failed for ${requestedUrl}: ${scrubSecret(error?.message || "network error", apiKey) || "network error"}.`,
      { code: "api_failure", url: requestedUrl }
    );
  }

  const bodyText = await response.text().catch(() => "");
  const shortBody = scrubSecret(bodyText, apiKey);

  let payload = null;
  if (bodyText.trim()) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = null;
    }
  }

  if (!response.ok || payload?.success === false || !payload) {
    const apiMessage =
      typeof payload?.error === "string"
        ? scrubSecret(payload.error, apiKey)
        : shortBody;
    throw new FirecrawlExtractError(
      `Firecrawl extraction failed for ${requestedUrl}: HTTP ${response.status}${apiMessage ? ` ${apiMessage}` : ""}.`,
      { code: "api_failure", url: requestedUrl, status: response.status }
    );
  }

  return normalizeFirecrawlPayload(payload, requestedUrl, apiKey);
}
