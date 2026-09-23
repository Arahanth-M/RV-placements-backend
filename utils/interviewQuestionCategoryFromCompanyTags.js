import CompanyStatic from "../models/CompanyStatic.js";
import {
  GENERAL_COMPANY_CATEGORIES,
  classifyGeneralCompanyCategory,
} from "./generalCompanyCategory.js";

export const GENERAL_COMPANY_CATEGORY_IDS = GENERAL_COMPANY_CATEGORIES.map(
  (entry) => entry.id
);

const toSafeString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

/**
 * @returns {Promise<Map<string, string>>} lowercased company name → category id
 */
export async function buildCompanyNameToCategoryMap() {
  const rows = await CompanyStatic.find({}, { name: 1, business_model: 1 }).lean();
  const map = new Map();
  for (const row of rows) {
    const name = toSafeString(row?.name);
    if (!name) continue;
    map.set(name.toLowerCase(), classifyGeneralCompanyCategory(row.business_model));
  }
  return map;
}

/**
 * Derive /general hub category ids from company name tags on a bank row.
 * @param {string[]} companyTags
 * @param {Map<string, string>} nameToCategory
 */
export function categoriesFromCompanyTags(companyTags, nameToCategory) {
  const out = new Set();
  const tags = Array.isArray(companyTags) ? companyTags : [];
  for (const tag of tags) {
    const key = toSafeString(tag).toLowerCase();
    if (!key) continue;
    const cat = nameToCategory.get(key);
    if (cat && GENERAL_COMPANY_CATEGORY_IDS.includes(cat)) {
      out.add(cat);
    }
  }
  return [...out];
}

export function normalizeQuestionCategoryList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => toSafeString(item).toLowerCase()).filter(Boolean))].filter(
    (id) => GENERAL_COMPANY_CATEGORY_IDS.includes(id)
  );
}
