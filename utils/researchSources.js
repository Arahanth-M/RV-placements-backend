/**
 * Client-safe research source links from company_platform_content.
 * @param {unknown} doc
 */
export function mapResearchSourcesForClient(doc) {
  const rows = Array.isArray(doc?.researchSources) ? doc.researchSources : [];
  const out = [];
  for (const row of rows) {
    const url = String(row?.url || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      prepRoleKey: String(row?.prepRoleKey ?? ""),
      title: String(row?.title || "").trim(),
      url,
      snippet: String(row?.snippet || "").trim(),
      score: typeof row?.score === "number" && Number.isFinite(row.score) ? row.score : null,
    });
  }
  return out;
}
