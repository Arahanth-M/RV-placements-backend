function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * @param {unknown} doc
 */
export function mapResearchLinksSummariesForClient(doc) {
  const rows = Array.isArray(doc?.researchLinksSummaries) ? doc.researchLinksSummaries : [];
  const out = [];
  for (const row of rows) {
    const summary = compact(row?.summary);
    if (!summary) continue;
    out.push({
      prepRoleKey: String(row?.prepRoleKey ?? ""),
      summary,
      updatedAt: row?.updatedAt || null,
    });
  }
  return out;
}

/**
 * Upsert one role summary in an in-memory array (Mongo write uses the result).
 * @param {unknown[]} existing
 * @param {{ prepRoleKey?: string, summary?: string }} entry
 */
export function upsertResearchLinksSummary(existing, entry) {
  const prepRoleKey = String(entry?.prepRoleKey ?? "");
  const summary = compact(entry?.summary);
  const base = Array.isArray(existing) ? existing.map((row) => ({ ...row })) : [];
  if (!summary) {
    return base.filter((row) => String(row?.prepRoleKey ?? "") !== prepRoleKey);
  }
  const idx = base.findIndex((row) => String(row?.prepRoleKey ?? "") === prepRoleKey);
  const record = {
    prepRoleKey,
    summary,
    updatedAt: new Date(),
  };
  if (idx >= 0) {
    base[idx] = record;
    return base;
  }
  base.push(record);
  return base;
}
