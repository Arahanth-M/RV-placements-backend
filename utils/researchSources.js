/**
 * Client-safe research source links from company_platform_content.
 * @param {unknown} doc
 */
/**
 * List payloads only need the role key (card role labels). Full title/url/snippet
 * stay on the company detail payload — those fields dominate GET /api/companies.
 * @param {unknown} doc
 */
export function mapResearchSourceRoleRefs(doc) {
  const rows = Array.isArray(doc?.researchSources) ? doc.researchSources : [];
  return rows.map((row) => ({
    prepRoleKey: String(row?.prepRoleKey ?? ""),
  }));
}

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
