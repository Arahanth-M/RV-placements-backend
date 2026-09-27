/**
 * Basic URL identity for dedupe. Not semantic similarity.
 * Returns null when the value is not an http(s) URL.
 * @param {unknown} raw
 * @returns {string | null}
 */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "yclid",
  "_ga",
]);

export function normalizeSourceUrl(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return null;

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase();
  let path = parsed.pathname || "/";
  if (path.length > 1) {
    path = path.replace(/\/+$/, "") || "/";
  }

  const defaultPort =
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80");
  const port = parsed.port && !defaultPort ? `:${parsed.port}` : "";

  const params = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) continue;
    params.push([key, value]);
  }
  params.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const search = params.length
    ? `?${params
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&")}`
    : "";

  return `${parsed.protocol}//${host}${port}${path}${search}`;
}
