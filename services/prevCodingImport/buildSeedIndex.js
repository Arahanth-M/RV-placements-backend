import path from "path";
import { fileURLToPath } from "url";

import { extractLeetCodeSlugFromUrl, normalizeTitleKey } from "./leetcodeSlug.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PREV_CODING_GAP_GENERATED_SEEDS = path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "data",
  "prev-coding-gap-generated-seeds.json"
);

function resolveQuestionUrl(row) {
  const direct = typeof row?.url === "string" ? row.url.trim() : "";
  if (direct) return direct;
  const src = typeof row?.sourceMetadata?.source === "string" ? row.sourceMetadata.source.trim() : "";
  if (/^https?:\/\//i.test(src)) return src;
  return "";
}

/**
 * First occurrence wins (stable file order).
 * @returns {{ bySlug: Map<string, object>, byNormTitle: Map<string, object> }}
 */
export function buildSeedIndexes(seedRows) {
  const bySlug = new Map();
  const byNormTitle = new Map();

  for (const row of seedRows) {
    if (!row || typeof row !== "object") continue;
    const url = resolveQuestionUrl(row);
    const slug = extractLeetCodeSlugFromUrl(url);
    if (slug && !bySlug.has(slug)) {
      bySlug.set(slug, row);
    }
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const tk = normalizeTitleKey(title);
    if (tk && !byNormTitle.has(tk)) {
      byNormTitle.set(tk, row);
    }
  }

  return { bySlug, byNormTitle };
}
