import CompanyStatic from "../../models/CompanyStatic.js";
import {
  GENERAL_COMPANY_CATEGORIES,
  classifyGeneralCompanyCategory,
} from "../../utils/generalCompanyCategory.js";

const TEASER_TTL_MS = 60 * 1000;
let cache = { at: 0, byCategory: {}, ids: new Set() };

function sortByName(a, b) {
  return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
    sensitivity: "base",
  });
}

/**
 * First company in each /general category after A–Z name sort.
 * Matches GeneralCompanyList: sort all, then group (insertion order).
 */
export async function getTeaserCompanyIndex() {
  const now = Date.now();
  if (now - cache.at < TEASER_TTL_MS && cache.byCategory) {
    return cache;
  }

  const rows = await CompanyStatic.find({})
    .select({ _id: 1, name: 1, business_model: 1, logo: 1 })
    .lean();
  const sorted = [...(Array.isArray(rows) ? rows : [])].sort(sortByName);
  const byCategory = Object.fromEntries(
    GENERAL_COMPANY_CATEGORIES.map((category) => [category.id, null])
  );

  for (const row of sorted) {
    const categoryId = classifyGeneralCompanyCategory(row?.business_model);
    if (byCategory[categoryId]) continue;
    byCategory[categoryId] = {
      _id: String(row._id),
      name: String(row.name || "").trim(),
      categoryId,
    };
  }

  const ids = new Set(
    Object.values(byCategory)
      .filter(Boolean)
      .map((row) => row._id)
  );

  cache = { at: now, byCategory, ids };
  return cache;
}

export async function isTeaserCompanyId(companyId) {
  const id = String(companyId || "").trim();
  if (!id) return false;
  const index = await getTeaserCompanyIndex();
  return index.ids.has(id);
}

export function invalidateTeaserCompanyCache() {
  cache = { at: 0, byCategory: {}, ids: new Set() };
}
