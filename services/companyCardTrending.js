/**
 * Company-card trending flags stored only in Redis (24h admin pin + recent view velocity).
 * Does not write company / visit / submission Mongo documents.
 */
import redis from "../utils/redis.js";
import { getJSON, setJSON, getSetMembers, addToSet, deleteKey } from "../src/utils/redisHelpers.js";
import { touchCardContentUpdated } from "./companyCardContentUpdated.js";
import CompanyVisit from "../models/CompanyVisit.js";
import CompanyStatic from "../models/CompanyStatic.js";
import { clusterKeyFromPlacementVisitClusterField } from "../utils/placementCluster.js";
import { laterDateIso } from "../utils/laterDate.js";
import {
  TRENDING_PIN_TTL_SECONDS,
  VIEW_HOUR_KEY_TTL_SECONDS,
  ADMIN_CARD_VIEWS_TTL_SECONDS,
  istHourBucket,
  isRapidViewSpike,
  trendingPinKey,
  trendingViewHourKey,
  stripCompanyListViews,
} from "./companyCardTrendingPure.js";

export {
  TRENDING_PIN_TTL_SECONDS,
  VIEW_HOUR_KEY_TTL_SECONDS,
  ADMIN_CARD_VIEWS_TTL_SECONDS,
  TRENDING_VIEWS_CURRENT_HOUR_MIN,
  TRENDING_VIEWS_TWO_HOUR_MIN,
  istHourBucket,
  isRapidViewSpike,
  trendingPinKey,
  trendingViewHourKey,
  stripCompanyListViews,
} from "./companyCardTrendingPure.js";

const PIN_INDEX_KEY = "visit:trending:pin:index";

function adminCardViewsKey(visitId) {
  return `visit:admin-views:${String(visitId)}`;
}

function visitIdString(visitId) {
  if (visitId == null || visitId === "") return "";
  return String(visitId);
}

export async function recordVisitViewVelocity(visitId, at = new Date()) {
  const id = visitIdString(visitId);
  if (!id) return false;
  const key = trendingViewHourKey(id, istHourBucket(at));
  try {
    await redis.incr(key);
    await redis.expire(key, VIEW_HOUR_KEY_TTL_SECONDS);
    return true;
  } catch {
    return false;
  }
}

async function readHourCount(visitId, bucket) {
  const id = visitIdString(visitId);
  if (!id || !bucket) return 0;
  try {
    const raw = await redis.get(trendingViewHourKey(id, bucket));
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export async function getVisitViewSpike(visitId, at = new Date()) {
  const current = await readHourCount(visitId, istHourBucket(at));
  const previous = await readHourCount(
    visitId,
    istHourBucket(new Date(at.getTime() - 60 * 60 * 1000))
  );
  return {
    currentHourViews: current,
    previousHourViews: previous,
    rapid: isRapidViewSpike(current, previous),
  };
}

function pinExpiresAtFromNow(now = new Date()) {
  return new Date(now.getTime() + TRENDING_PIN_TTL_SECONDS * 1000);
}

export async function pinVisitTrending(visitId, now = new Date()) {
  const id = visitIdString(visitId);
  if (!id) {
    const err = new Error("visitId required");
    err.statusCode = 400;
    throw err;
  }

  const visit = await CompanyVisit.findById(id)
    .select("companyId year type cluster status")
    .lean();
  if (!visit) {
    const err = new Error("Company visit not found");
    err.statusCode = 404;
    throw err;
  }

  const company = visit.companyId
    ? await CompanyStatic.findById(visit.companyId).select("name").lean()
    : null;

  const payload = {
    visitId: id,
    companyId: visit.companyId ? String(visit.companyId) : "",
    companyName: String(company?.name || "Unknown company"),
    year: Number(visit.year) || null,
    type: String(visit.type || ""),
    cluster: String(visit.cluster || ""),
    clusterKey: clusterKeyFromPlacementVisitClusterField(visit.cluster),
    pinnedAt: now.toISOString(),
    expiresAt: pinExpiresAtFromNow(now).toISOString(),
  };

  await setJSON(trendingPinKey(id), payload, TRENDING_PIN_TTL_SECONDS);
  await addToSet(PIN_INDEX_KEY, id, TRENDING_PIN_TTL_SECONDS + 60);
  await touchCardContentUpdated({ companyId: visit.companyId, visitId: id, at: now });
  return payload;
}

export async function unpinVisitTrending(visitId) {
  const id = visitIdString(visitId);
  if (!id) return false;
  const pin = await getJSON(trendingPinKey(id));
  await deleteKey(trendingPinKey(id));
  try {
    await redis.sRem(PIN_INDEX_KEY, id);
  } catch {
    // index is best-effort
  }
  const companyId = pin && typeof pin === "object" ? pin.companyId : null;
  await touchCardContentUpdated({ companyId, visitId: id });
  return true;
}

export async function getPinnedTrending(visitId) {
  const id = visitIdString(visitId);
  if (!id) return null;
  const row = await getJSON(trendingPinKey(id));
  if (!row || typeof row !== "object") return null;
  const exp = row.expiresAt ? new Date(row.expiresAt).getTime() : 0;
  if (exp && exp <= Date.now()) return null;
  return row;
}

export async function listPinnedTrendingCards() {
  const ids = await getSetMembers(PIN_INDEX_KEY);
  const rows = [];
  const stale = [];
  for (const id of ids || []) {
    const pin = await getPinnedTrending(id);
    if (pin) rows.push(pin);
    else stale.push(id);
  }
    if (stale.length) {
    try {
      for (const id of stale) {
        await redis.sRem(PIN_INDEX_KEY, id);
      }
    } catch {
      // ignore
    }
  }
  rows.sort((a, b) => String(b.pinnedAt || "").localeCompare(String(a.pinnedAt || "")));
  return rows;
}

/**
 * @param {string[]} visitIds
 * @returns {Promise<Record<string, { trending: boolean, reason: 'admin'|'views'|null }>>}
 */
export async function getTrendingStatusForVisitIds(visitIds, at = new Date()) {
  /** @type {Record<string, { trending: boolean, reason: 'admin'|'views'|null }>} */
  const out = {};
  const ids = [...new Set((Array.isArray(visitIds) ? visitIds : []).map(visitIdString).filter(Boolean))];
  await Promise.all(
    ids.map(async (id) => {
      const pin = await getPinnedTrending(id);
      if (pin) {
        out[id] = { trending: true, reason: "admin", pinnedAt: pin.pinnedAt || null };
        return;
      }
      const spike = await getVisitViewSpike(id, at);
      out[id] = spike.rapid
        ? { trending: true, reason: "views" }
        : { trending: false, reason: null };
    })
  );
  return out;
}

export async function attachTrendingFlagsToCompanyList(list, at = new Date()) {
  const rows = Array.isArray(list) ? list : [];
  const ids = rows.map((c) => visitIdString(c?.placementCompanyVisitId)).filter(Boolean);
  const flags = await getTrendingStatusForVisitIds(ids, at);
  return rows.map((c) => {
    const id = visitIdString(c?.placementCompanyVisitId);
    const flag = id ? flags[id] : null;
    return {
      ...c,
      trending: flag?.trending === true,
      trendingReason: flag?.reason || null,
      contentUpdatedAt:
        laterDateIso(c.contentUpdatedAt, flag?.pinnedAt) || c.contentUpdatedAt || null,
    };
  });
}

/**
 * Attach 3-hour Redis snapshots of visit.views for admin list responses.
 * Reads Mongo only when a snapshot is missing/expired. Does not write visit documents.
 * @param {Record<string, unknown>[]} list
 */
export async function attachAdminCompanyCardViews(list) {
  const rows = stripCompanyListViews(list);
  const ids = [
    ...new Set(rows.map((c) => visitIdString(c?.placementCompanyVisitId)).filter(Boolean)),
  ];
  if (ids.length === 0) return rows;

  /** @type {Map<string, number>} */
  const viewsById = new Map();
  let raws = [];
  try {
    raws = await redis.mGet(ids.map((id) => adminCardViewsKey(id)));
  } catch {
    raws = ids.map(() => null);
  }

  const missing = [];
  ids.forEach((id, i) => {
    const raw = raws[i];
    if (raw == null || raw === "") {
      missing.push(id);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const n = Number(parsed?.views);
      if (Number.isFinite(n)) viewsById.set(id, Math.max(0, n));
      else missing.push(id);
    } catch {
      missing.push(id);
    }
  });

  if (missing.length > 0) {
    const visits = await CompanyVisit.find({ _id: { $in: missing } })
      .select("views")
      .lean();
    const found = new Set();
    await Promise.all(
      visits.map(async (visit) => {
        const id = visitIdString(visit?._id);
        if (!id) return;
        found.add(id);
        const count = Math.max(0, Number(visit.views) || 0);
        viewsById.set(id, count);
        await setJSON(adminCardViewsKey(id), { views: count, capturedAt: new Date().toISOString() }, ADMIN_CARD_VIEWS_TTL_SECONDS);
      })
    );
    for (const id of missing) {
      if (found.has(id)) continue;
      viewsById.set(id, 0);
      await setJSON(adminCardViewsKey(id), { views: 0, capturedAt: new Date().toISOString() }, ADMIN_CARD_VIEWS_TTL_SECONDS);
    }
  }

  return rows.map((row) => {
    const id = visitIdString(row?.placementCompanyVisitId);
    return {
      ...row,
      views: id ? viewsById.get(id) || 0 : 0,
    };
  });
}

export async function listApprovedVisitsForTrendingPicker(companyId) {
  const cid = companyId == null ? "" : String(companyId).trim();
  if (!cid) return [];
  const company = await CompanyStatic.findById(cid).select("name").lean();
  if (!company) return [];
  const visits = await CompanyVisit.find({ companyId: cid, status: "approved" })
    .select("year type cluster")
    .sort({ year: -1, _id: -1 })
    .lean();
  return visits.map((v) => ({
    visitId: String(v._id),
    companyId: cid,
    companyName: String(company.name || ""),
    year: Number(v.year) || null,
    type: String(v.type || ""),
    cluster: String(v.cluster || ""),
    clusterKey: clusterKeyFromPlacementVisitClusterField(v.cluster),
  }));
}
