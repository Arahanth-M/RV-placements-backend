/** Pure trending helpers (no Redis / Mongo). */
import { clusterKeyFromPlacementVisitClusterField } from "../utils/placementCluster.js";

export const TRENDING_PIN_TTL_SECONDS = 24 * 60 * 60;
export const VIEW_HOUR_KEY_TTL_SECONDS = 3 * 60 * 60;
/** How often admin-visible card view counts refresh from Mongo into Redis. */
export const ADMIN_CARD_VIEWS_TTL_SECONDS = 3 * 60 * 60;
export const TRENDING_VIEWS_CURRENT_HOUR_MIN = 8;
export const TRENDING_VIEWS_TWO_HOUR_MIN = 12;

export function trendingPinKey(visitId) {
  return `visit:trending:pin:${String(visitId)}`;
}

export function trendingViewHourKey(visitId, hourBucket) {
  return `visit:views:h:${String(visitId)}:${hourBucket}`;
}

/** IST calendar hour YYYYMMDDHH for velocity buckets. */
export function istHourBucket(date = new Date()) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}${parts.month}${parts.day}${parts.hour}`;
}

export function isRapidViewSpike(currentHourCount, previousHourCount) {
  const current = Math.max(0, Number(currentHourCount) || 0);
  const previous = Math.max(0, Number(previousHourCount) || 0);
  if (current >= TRENDING_VIEWS_CURRENT_HOUR_MIN) return true;
  if (current + previous >= TRENDING_VIEWS_TWO_HOUR_MIN) return true;
  if (previous >= 3 && current >= previous * 2) return true;
  return false;
}

function idString(value) {
  if (value == null || value === "") return "";
  return String(value);
}

/** Hub card identity: one row per company per cluster. */
export function companyClusterPinKey(companyId, clusterRaw) {
  const id = idString(companyId);
  if (!id) return "";
  return `${id}::${clusterKeyFromPlacementVisitClusterField(clusterRaw)}`;
}

/**
 * Admin pins are stored per visit, but the hub renders one card per company+cluster
 * (its visit id is the dream/FTE row). A pin on any sibling visit in that pair applies.
 * @param {Record<string, unknown>|null|undefined} row
 * @param {Array<Record<string, unknown>>|null|undefined} pins
 * @returns {Record<string, unknown>|null}
 */
export function findAdminPinForCompanyCard(row, pins) {
  const key = companyClusterPinKey(row?._id, row?.cluster);
  if (!key || !Array.isArray(pins)) return null;
  let best = null;
  for (const pin of pins) {
    if (!pin || typeof pin !== "object") continue;
    const pinKey = companyClusterPinKey(pin.companyId, pin.clusterKey || pin.cluster);
    if (pinKey !== key) continue;
    if (!best || String(pin.pinnedAt || "") > String(best.pinnedAt || "")) {
      best = pin;
    }
  }
  return best;
}

/** Drop view counts so student/SPC list payloads never include them. */
export function stripCompanyListViews(list) {
  return (Array.isArray(list) ? list : []).map((row) => {
    if (!row || typeof row !== "object") return row;
    const next = { ...row };
    delete next.views;
    return next;
  });
}
