import mongoose from "mongoose";
import CompanyStatic from "../models/CompanyStatic.js";
import CompanyPlatformContent from "../models/CompanyPlatformContent.js";
import { withKeyedAsyncMutex } from "../utils/keyedAsyncMutex.js";
import { invalidateCompanyDetailCache } from "./companyDetailCache.js";
import {
  normalizePrepRoleKey,
  prepRoleCatalogMissing,
  prepRoleScopedKey,
} from "../utils/prepRole.js";
import { buildInterviewSearchQueries } from "./companyResearch/researchInterviewQuestions.js";
import { searchWeb } from "./companyResearch/tavilySearch.js";
import { normalizeSourceUrl } from "./companyResearch/urlNormalize.js";
import { collectResearchSourcesToInsert } from "./companyResearch/publishResearchInterviewQuestions.js";

const DEFAULT_MAX_PER_ROLE = 5;
const MAX_PER_ROLE_CAP = 8;
const MAX_ROLES = 12;
const PER_QUERY_RESULTS = 5;

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function asObjectId(value) {
  try {
    return new mongoose.Types.ObjectId(String(value));
  } catch {
    return null;
  }
}

function resolveMaxPerRole(value) {
  if (value == null || value === "") return DEFAULT_MAX_PER_ROLE;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_MAX_PER_ROLE;
  return Math.min(n, MAX_PER_ROLE_CAP);
}

/**
 * Normalize role inputs from the CSV import UI.
 * @param {unknown[]} rawRoles
 * @returns {Array<{ key: string, label: string }>}
 */
export function normalizeQuickLinkRoles(rawRoles) {
  const list = Array.isArray(rawRoles) ? rawRoles : [];
  const byKey = new Map();
  for (const row of list) {
    if (typeof row === "string") {
      const normalized = normalizePrepRoleKey(row);
      if (!normalized.key) continue;
      byKey.set(normalized.key, normalized);
      continue;
    }
    const label = compact(row?.label) || compact(row?.prepRoleLabel) || compact(row?.role);
    const existingKey = compact(row?.key) || compact(row?.prepRoleKey);
    const normalized = normalizePrepRoleKey(label || existingKey);
    const key = existingKey || normalized.key;
    if (!key) continue;
    byKey.set(key, {
      key,
      label: label || normalized.label || key,
    });
    if (byKey.size >= MAX_ROLES) break;
  }
  return [...byKey.values()];
}

async function searchSourcesForRole({ companyName, roleLabel, country, maxPerRole }) {
  const queries = buildInterviewSearchQueries({
    companyName,
    role: roleLabel,
    country,
  });
  const searched = [];
  for (const query of queries) {
    const rows = await searchWeb(query, {
      maxResults: PER_QUERY_RESULTS,
      searchDepth: "basic",
    });
    searched.push(...(Array.isArray(rows) ? rows : []));
  }

  const seen = new Set();
  const unique = [];
  for (const row of searched) {
    const url = compact(row?.url);
    if (!url) continue;
    const key = normalizeSourceUrl(url) || url;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      title: compact(row?.title),
      url,
      snippet: compact(row?.snippet),
      score: typeof row?.score === "number" && Number.isFinite(row.score) ? row.score : null,
    });
    if (unique.length >= maxPerRole) break;
  }
  return unique;
}

/**
 * Tavily-only quick links for CSV roles. Does not scrape pages or extract questions.
 * @param {{
 *   companyId?: string,
 *   roles?: unknown[],
 *   country?: string,
 *   maxPerRole?: number,
 * }} input
 */
export async function fetchQuickLinksForPrepRoles(input = {}) {
  const oid = asObjectId(input.companyId);
  if (!oid) {
    const err = new Error("Invalid company id");
    err.status = 400;
    throw err;
  }

  const roles = normalizeQuickLinkRoles(input.roles);
  if (!roles.length) {
    const err = new Error("Provide at least one role from the imported CSV.");
    err.status = 400;
    throw err;
  }

  const staticRow = await CompanyStatic.findById(oid).select({ name: 1 }).lean();
  if (!staticRow) {
    const err = new Error("Company not found");
    err.status = 404;
    throw err;
  }

  const companyName = compact(staticRow.name);
  if (!companyName) {
    const err = new Error("Company name is missing.");
    err.status = 400;
    throw err;
  }

  const country = compact(input.country) || "India";
  const maxPerRole = resolveMaxPerRole(input.maxPerRole);
  const roleResults = [];

  for (const role of roles) {
    try {
      const sources = await searchSourcesForRole({
        companyName,
        roleLabel: role.label,
        country,
        maxPerRole,
      });
      roleResults.push({
        key: role.key,
        label: role.label,
        status: "ok",
        found: sources.length,
        sources,
      });
    } catch (error) {
      roleResults.push({
        key: role.key,
        label: role.label,
        status: "failed",
        found: 0,
        sources: [],
        error: compact(error?.message) || "Search failed.",
      });
    }
  }

  return withKeyedAsyncMutex(`platform-content:${String(oid)}`, async () => {
    let doc = await CompanyPlatformContent.findOne({ companyId: oid });
    if (!doc) {
      doc = await CompanyPlatformContent.create({
        companyId: oid,
        researchSources: [],
        prepRoles: [],
      });
    }

    const existingScopedKeys = new Set(
      (Array.isArray(doc.researchSources) ? doc.researchSources : [])
        .map((item) => prepRoleScopedKey(item?.prepRoleKey, normalizeSourceUrl(item?.url)))
        .filter((key) => Boolean(String(key).split("\0")[1]))
    );

    let inserted = 0;
    let duplicates = 0;
    const existingRoles = Array.isArray(doc.prepRoles) ? [...doc.prepRoles] : [];
    let rolesAdded = 0;
    const perRole = [];

    for (const roleResult of roleResults) {
      if (roleResult.status !== "ok") {
        perRole.push({
          key: roleResult.key,
          label: roleResult.label,
          status: "failed",
          inserted: 0,
          duplicates: 0,
          found: 0,
          error: roleResult.error,
        });
        continue;
      }

      const { toInsert, duplicateSourceCount } = collectResearchSourcesToInsert(
        roleResult.sources,
        existingScopedKeys,
        roleResult.key
      );
      if (toInsert.length) {
        doc.researchSources.push(...toInsert);
        inserted += toInsert.length;
      }
      duplicates += duplicateSourceCount;

      const roleEntry = { key: roleResult.key, label: roleResult.label };
      if (
        roleEntry.key &&
        prepRoleCatalogMissing(existingRoles, roleEntry)
      ) {
        doc.prepRoles.push(roleEntry);
        existingRoles.push(roleEntry);
        rolesAdded += 1;
      }

      perRole.push({
        key: roleResult.key,
        label: roleResult.label,
        status: "ok",
        inserted: toInsert.length,
        duplicates: duplicateSourceCount,
        found: roleResult.found,
      });
    }

    if (inserted > 0 || rolesAdded > 0) {
      if (inserted > 0) doc.markModified("researchSources");
      if (rolesAdded > 0) doc.markModified("prepRoles");
      await doc.save();
      await invalidateCompanyDetailCache(String(oid));
    }

    return {
      companyId: String(oid),
      companyName,
      rolesRequested: roles.length,
      inserted,
      duplicates,
      rolesAdded,
      perRole,
    };
  });
}
