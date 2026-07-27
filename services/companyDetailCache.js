import redis from "../utils/redis.js";
import {
  COMPANY_DETAIL_VISIT_YEARS,
  COMPANY_VISIT_DEFAULT_YEAR,
} from "../utils/placementYears.js";
import { normalizePlacementClusterQuery } from "../utils/placementCluster.js";
import { normalizePlacementUniversityQuery } from "../utils/placementUniversity.js";

/** Detail Redis keys include every year in {@link COMPANY_DETAIL_VISIT_YEARS}. */
const DETAIL_CACHE_YEAR_SUFFIXES = COMPANY_DETAIL_VISIT_YEARS.map(String);

/** Slug segment for Redis key; matches `placementContext` query values. */
const DETAIL_CONTEXT_SLUGS = ["_", "summer_internship", "dream", "open_dream"];

/** Cluster segment for GET /companies/:id cache keys (`placementCluster` query). */
const DETAIL_CLUSTER_SLUGS = ["_", "cs", "ec", "me", "chem"];

/** University segment for GET /companies/:id cache keys (`placementUniversity` query). */
const DETAIL_UNIVERSITY_SLUGS = ["_", "A", "B", "C", "D", "E"];

/**
 * Bump when cached GET /companies/:id payload shape changes so stale Redis rows are not reused.
 * @see placementDetailHeadlineType, placementContext merge selection, placementCluster, placementUniversity
 */
export const COMPANY_DETAIL_CACHE_SCHEMA = "v19";

/**
 * @param {unknown} raw — req.query.placementContext or equivalent
 * @returns {string} slug for Redis key
 */
export function placementDetailCacheContextSlug(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (s === "summer_internship") return "summer_internship";
  if (s === "dream") return "dream";
  if (s === "open_dream") return "open_dream";
  return "_";
}

/**
 * @param {unknown} raw — `req.query.placementCluster`
 * @returns {string} "_" or cs|ec|me|chem
 */
export function placementDetailClusterSlug(raw) {
  const c = normalizePlacementClusterQuery(raw);
  return c == null ? "_" : c;
}

/**
 * @param {unknown} raw — `req.query.placementUniversity`
 * @returns {string} "_" or A–E
 */
export function placementDetailUniversitySlug(raw) {
  const u = normalizePlacementUniversityQuery(raw);
  return u == null ? "_" : u;
}

/**
 * @param {unknown} companyId
 * @param {number|string|null|undefined} placementYear resolved placement year (e.g. 2026)
 * @param {unknown} [placementContextRaw] optional GET placementContext query
 * @param {unknown} [placementClusterRaw] optional GET placementCluster query
 * @param {unknown} [placementUniversityRaw] optional GET placementUniversity query
 */
export function companyDetailRedisKey(
  companyId,
  placementYear,
  placementContextRaw = null,
  placementClusterRaw = null,
  placementUniversityRaw = null
) {
  if (companyId == null || companyId === "") return null;
  const id =
    typeof companyId === "object" && companyId !== null && "toString" in companyId
      ? companyId.toString()
      : String(companyId);
  if (!id || id === "undefined") return null;
  const y =
    placementYear == null || placementYear === ""
      ? String(COMPANY_VISIT_DEFAULT_YEAR)
      : String(placementYear);
  const slug = placementDetailCacheContextSlug(placementContextRaw);
  const clusterSlug = placementDetailClusterSlug(placementClusterRaw);
  const universitySlug = placementDetailUniversitySlug(placementUniversityRaw);
  return `company:${id}:y${y}:${COMPANY_DETAIL_CACHE_SCHEMA}:${slug}:${clusterSlug}:${universitySlug}`;
}

/**
 * Drop cached payload for GET /api/companies/:id so the next read rebuilds from MongoDB.
 * Safe if Redis is down or REDIS_URL unset (redis client no-ops or errors are swallowed).
 */
export async function invalidateCompanyDetailCache(companyId) {
  const id =
    companyId == null || companyId === ""
      ? null
      : typeof companyId === "object" && companyId !== null && "toString" in companyId
        ? companyId.toString()
        : String(companyId);
  if (!id || id === "undefined") return;
  const keys = [
    `company:${id}`,
    ...DETAIL_CACHE_YEAR_SUFFIXES.flatMap((y) => {
      const parts = [`company:${id}:y${y}`, `company:${id}:y${y}:v5`];
      for (const schema of ["v6", "v7", "v18", COMPANY_DETAIL_CACHE_SCHEMA]) {
        for (const slug of DETAIL_CONTEXT_SLUGS) {
          parts.push(`company:${id}:y${y}:${schema}:${slug}`);
          for (const cl of DETAIL_CLUSTER_SLUGS) {
            parts.push(`company:${id}:y${y}:${schema}:${slug}:${cl}`);
            for (const uni of DETAIL_UNIVERSITY_SLUGS) {
              parts.push(`company:${id}:y${y}:${schema}:${slug}:${cl}:${uni}`);
            }
          }
        }
      }
      return parts;
    }),
  ];
  try {
    await redis.del(keys);
  } catch {
    // Optional cache — ignore failures
  }
}
