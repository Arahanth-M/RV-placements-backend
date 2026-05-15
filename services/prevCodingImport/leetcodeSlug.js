/**
 * Extract LeetCode problem slug from common URL shapes.
 * e.g. https://leetcode.com/problems/two-sum/ → two-sum
 */
export function extractLeetCodeSlugFromUrl(url) {
  const s = typeof url === "string" ? url.trim() : "";
  if (!s) return "";
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    const m = u.pathname.match(/\/problems\/([^/]+)/i);
    if (!m) return "";
    return decodeURIComponent(m[1]).trim().toLowerCase();
  } catch {
    const rel = s.replace(/^https?:\/\//i, "");
    const m2 = rel.match(/leetcode\.com\/problems\/([^/?#]+)/i);
    if (!m2) return "";
    return decodeURIComponent(m2[1]).trim().toLowerCase();
  }
}

/** Normalize title for seed lookup: lowercase alphanumeric only. */
export function normalizeTitleKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Rough "slug" from plain title e.g. "Two Sum" → "two-sum" */
export function titleLikeSlug(title) {
  return String(title || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
