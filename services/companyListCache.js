/**
 * Redis cache for GET /api/companies list JSON + 2026 visit roles.
 * Read/write Redis only — never mutates Mongo company/visit documents.
 */
import redis from "../utils/redis.js";
import { getJSON, setJSON, deleteKeysByPrefix, addToSet, getSetMembers } from "../src/utils/redisHelpers.js";
import { normalizeCollegeId, DEFAULT_COLLEGE_ID } from "../utils/collegeScope.js";
import { normalizePlacementClusterQuery } from "../utils/placementCluster.js";
import { COMPANY_VISIT_DEFAULT_YEAR } from "../utils/placementYears.js";

function normalizeListYear(raw) {
  const y = Number(raw);
  if (!Number.isFinite(y)) return null;
  return Math.trunc(y);
}

/** Bump when list payload shape changes. */
export const COMPANY_LIST_CACHE_SCHEMA = "v6";

/** Safety TTL for full list responses (hard invalidate on writes too). */
export const COMPANY_LIST_REDIS_TTL_SECONDS = 10 * 60;

/** 2026 roles are stable; long TTL + invalidate only on roles writes. */
export const COMPANY_ROLES_2026_CACHE_YEAR = 2026;
export const COMPANY_ROLES_REDIS_TTL_SECONDS = 7 * 24 * 60 * 60;
export const COMPANY_ROLES_CACHE_SCHEMA = "v1";

/**
 * @param {unknown} placementYear
 * @param {unknown} clusterRaw
 * @param {unknown} collegeIdRaw
 */
export function companyListRedisKey(placementYear, clusterRaw, collegeIdRaw) {
  const y =
    placementYear == null || placementYear === ""
      ? "all"
      : `y${normalizeListYear(placementYear) ?? COMPANY_VISIT_DEFAULT_YEAR}`;
  const cluster = normalizePlacementClusterQuery(clusterRaw) || "_";
  const college =
    collegeIdRaw != null && String(collegeIdRaw).trim() !== ""
      ? normalizeCollegeId(collegeIdRaw)
      : DEFAULT_COLLEGE_ID;
  return `companies:list:${COMPANY_LIST_CACHE_SCHEMA}:${y}:c${cluster}:college:${college}`;
}

/**
 * @param {unknown} visitId
 */
export function visitRoles2026RedisKey(visitId) {
  if (visitId == null || visitId === "") return null;
  const id =
    typeof visitId === "object" && visitId !== null && "toString" in visitId
      ? visitId.toString()
      : String(visitId);
  if (!id || id === "undefined") return null;
  return `visit:roles:${COMPANY_ROLES_CACHE_SCHEMA}:y${COMPANY_ROLES_2026_CACHE_YEAR}:${id}`;
}

/**
 * @param {unknown} companyId
 */
function companyRolesVisitIndexKey(companyId) {
  if (companyId == null || companyId === "") return null;
  const id =
    typeof companyId === "object" && companyId !== null && "toString" in companyId
      ? companyId.toString()
      : String(companyId);
  if (!id || id === "undefined") return null;
  return `visit:roles:index:y${COMPANY_ROLES_2026_CACHE_YEAR}:c${id}`;
}

/**
 * @param {unknown} placementYear
 * @param {unknown} clusterRaw
 * @param {unknown} collegeIdRaw
 * @returns {Promise<unknown[]|null>}
 */
export async function getCachedCompanyList(placementYear, clusterRaw, collegeIdRaw) {
  const key = companyListRedisKey(placementYear, clusterRaw, collegeIdRaw);
  const cached = await getJSON(key);
  return Array.isArray(cached) ? cached : null;
}

/**
 * @param {unknown} placementYear
 * @param {unknown} clusterRaw
 * @param {unknown} collegeIdRaw
 * @param {unknown[]} list
 */
export async function setCachedCompanyList(placementYear, clusterRaw, collegeIdRaw, list) {
  if (!Array.isArray(list)) return false;
  const key = companyListRedisKey(placementYear, clusterRaw, collegeIdRaw);
  return setJSON(key, list, COMPANY_LIST_REDIS_TTL_SECONDS);
}

/** Drop all company list cache keys (any year/cluster/college). */
export async function invalidateCompanyListCache() {
  try {
    await deleteKeysByPrefix(`companies:list:${COMPANY_LIST_CACHE_SCHEMA}:`);
    // Legacy / accidental prefixes
    await deleteKeysByPrefix("companies:list:");
  } catch {
    // Optional cache
  }
}

/**
 * @param {unknown} visitId
 * @returns {Promise<unknown[]|null>}
 */
export async function getCachedVisitRoles2026(visitId) {
  const key = visitRoles2026RedisKey(visitId);
  if (!key) return null;
  const cached = await getJSON(key);
  return Array.isArray(cached) ? cached : null;
}

/**
 * @param {unknown} visitId
 * @param {unknown} companyId
 * @param {unknown[]} roles
 */
export async function setCachedVisitRoles2026(visitId, companyId, roles) {
  const key = visitRoles2026RedisKey(visitId);
  if (!key || !Array.isArray(roles)) return false;
  const ok = await setJSON(key, roles, COMPANY_ROLES_REDIS_TTL_SECONDS);
  const indexKey = companyRolesVisitIndexKey(companyId);
  if (ok && indexKey) {
    await addToSet(indexKey, String(visitId), COMPANY_ROLES_REDIS_TTL_SECONDS);
  }
  return ok;
}

/**
 * Invalidate 2026 roles cache for one visit and/or all indexed visits of a company.
 * Redis-only — does not touch Mongo.
 * @param {{ visitId?: unknown, companyId?: unknown }} refs
 */
export async function invalidateVisitRoles2026Cache(refs = {}) {
  const keys = [];
  const visitKey = visitRoles2026RedisKey(refs.visitId);
  if (visitKey) keys.push(visitKey);

  const indexKey = companyRolesVisitIndexKey(refs.companyId);
  if (indexKey) {
    const members = await getSetMembers(indexKey);
    for (const mid of members || []) {
      const k = visitRoles2026RedisKey(mid);
      if (k) keys.push(k);
    }
    keys.push(indexKey);
  }

  if (!keys.length) return;
  try {
    await redis.del(keys);
  } catch {
    // Optional cache
  }
}

/**
 * Hydrate `roles` on 2026 visit docs from Redis when present; cache misses from Mongo payload.
 * Mutates the in-memory visit objects only (no DB writes).
 * @param {Record<string, unknown>[]} visits
 */
export async function hydrateVisitRoles2026FromCache(visits) {
  const list = Array.isArray(visits) ? visits : [];
  const targets = list.filter(
    (v) =>
      v &&
      Number(v.year) === COMPANY_ROLES_2026_CACHE_YEAR &&
      v._id != null
  );
  if (!targets.length) return;

  const keys = targets.map((v) => visitRoles2026RedisKey(v._id)).filter(Boolean);
  if (!keys.length) return;

  let values = [];
  try {
    values = await redis.mGet(keys);
  } catch {
    return;
  }

  const toCache = [];
  for (let i = 0; i < targets.length; i += 1) {
    const visit = targets[i];
    const raw = values[i];
    if (raw != null && raw !== "") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          visit.roles = parsed;
          continue;
        }
      } catch {
        // fall through — keep Mongo roles
      }
    }
    if (Array.isArray(visit.roles)) {
      toCache.push(visit);
    }
  }

  // Populate cache from Mongo roles (read path only)
  await Promise.all(
    toCache.map((v) => setCachedVisitRoles2026(v._id, v.companyId, v.roles))
  );
}
