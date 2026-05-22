import PlacementHubSettings from "../models/PlacementHubSettings.js";
import {
  PLACEMENT_HUB_CLUSTER_KEYS,
  clusterKeyFromPlacementVisitClusterField,
} from "../utils/placementCluster.js";
import {
  COMPANY_VISIT_DEFAULT_YEAR,
  PLACEMENT_OPEN_DREAM_SETTING_YEARS,
  normalizePlacementOpenDreamSettingYear,
} from "../utils/placementYears.js";

const RUPEES_PER_LPA = 100_000;

export const DEFAULT_OPEN_DREAM_MIN_LPA = 10;
const SETTINGS_DOC_KEY = "default";

/** @type {Record<string, Record<string, number>>|null} */
let cachedOpenDreamMinLpaByYear = null;

function defaultOpenDreamMinLpaByCluster() {
  return Object.fromEntries(
    PLACEMENT_HUB_CLUSTER_KEYS.map((k) => [k, DEFAULT_OPEN_DREAM_MIN_LPA])
  );
}

function defaultOpenDreamMinLpaByYear() {
  return Object.fromEntries(
    PLACEMENT_OPEN_DREAM_SETTING_YEARS.map((y) => [
      String(y),
      defaultOpenDreamMinLpaByCluster(),
    ])
  );
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizePlacementHubClusterKey(raw) {
  return clusterKeyFromPlacementVisitClusterField(raw);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeMinLpa(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_OPEN_DREAM_MIN_LPA;
  return Math.min(200, Math.round(n * 100) / 100);
}

/**
 * @param {Record<string, unknown>|null|undefined} raw
 * @returns {Record<string, number>}
 */
function normalizeClusterThresholdMap(raw) {
  const base = defaultOpenDreamMinLpaByCluster();
  if (!raw || typeof raw !== "object") return base;
  for (const key of PLACEMENT_HUB_CLUSTER_KEYS) {
    if (raw[key] != null) base[key] = normalizeMinLpa(raw[key]);
  }
  return base;
}

/**
 * @param {Record<string, unknown>|Map|null|undefined} rawByYear
 * @returns {Record<string, Record<string, number>>}
 */
function normalizeOpenDreamMinLpaByYear(rawByYear) {
  const out = defaultOpenDreamMinLpaByYear();
  if (!rawByYear) return out;

  const entries =
    rawByYear instanceof Map
      ? [...rawByYear.entries()]
      : Object.entries(rawByYear);

  for (const [yearKey, clusterMap] of entries) {
    const y = normalizePlacementOpenDreamSettingYear(yearKey);
    if (y === undefined) continue;
    out[String(y)] = normalizeClusterThresholdMap(
      clusterMap && typeof clusterMap === "object"
        ? Object.fromEntries(
            PLACEMENT_HUB_CLUSTER_KEYS.map((k) => [k, clusterMap[k]])
          )
        : null
    );
  }
  return out;
}

function isDefaultYearMatrix(byYear) {
  return PLACEMENT_OPEN_DREAM_SETTING_YEARS.every((y) =>
    PLACEMENT_HUB_CLUSTER_KEYS.every(
      (k) => (byYear[String(y)]?.[k] ?? DEFAULT_OPEN_DREAM_MIN_LPA) === DEFAULT_OPEN_DREAM_MIN_LPA
    )
  );
}

/**
 * @param {Record<string, unknown>|null|undefined} doc
 */
function applyCacheFromDoc(doc) {
  if (!doc) {
    cachedOpenDreamMinLpaByYear = defaultOpenDreamMinLpaByYear();
    return;
  }

  const fromYear = normalizeOpenDreamMinLpaByYear(doc.openDreamMinLpaByYear);
  const legacy = doc.openDreamMinLpaByCluster;
  const legacyMap =
    legacy && typeof legacy === "object"
      ? normalizeClusterThresholdMap(
          Object.fromEntries(
            PLACEMENT_HUB_CLUSTER_KEYS.map((k) => [k, legacy[k]])
          )
        )
      : null;

  if (legacyMap && isDefaultYearMatrix(fromYear)) {
    cachedOpenDreamMinLpaByYear = Object.fromEntries(
      PLACEMENT_OPEN_DREAM_SETTING_YEARS.map((y) => [String(y), { ...legacyMap }])
    );
    return;
  }

  cachedOpenDreamMinLpaByYear = fromYear;
}

export async function loadPlacementHubSettingsCache() {
  const doc = await PlacementHubSettings.findOne({ settingsKey: SETTINGS_DOC_KEY })
    .lean()
    .exec();
  applyCacheFromDoc(doc);
  return getOpenDreamMinLpaByYearSync();
}

/**
 * @returns {Record<string, Record<string, number>>}
 */
export function getOpenDreamMinLpaByYearSync() {
  if (!cachedOpenDreamMinLpaByYear) {
    return defaultOpenDreamMinLpaByYear();
  }
  const out = defaultOpenDreamMinLpaByYear();
  for (const year of PLACEMENT_OPEN_DREAM_SETTING_YEARS) {
    const key = String(year);
    out[key] = {
      ...out[key],
      ...(cachedOpenDreamMinLpaByYear[key] || {}),
    };
  }
  return out;
}

/** @deprecated — use {@link getOpenDreamMinLpaByYearSync} */
export function getOpenDreamMinLpaByClusterSync() {
  const byYear = getOpenDreamMinLpaByYearSync();
  return (
    byYear[String(COMPANY_VISIT_DEFAULT_YEAR)] ?? defaultOpenDreamMinLpaByCluster()
  );
}

/**
 * @param {unknown} yearRaw
 * @returns {string}
 */
function resolveThresholdYearKey(yearRaw) {
  return (
    String(
      normalizePlacementOpenDreamSettingYear(yearRaw) ?? COMPANY_VISIT_DEFAULT_YEAR
    )
  );
}

/**
 * @param {unknown} clusterRaw — hub key or visit.cluster string
 * @param {unknown} [yearRaw] — placement cycle (2024–2028)
 * @returns {number} annual rupees threshold for Open dream
 */
export function getOpenDreamMinRupeesForClusterSync(clusterRaw, yearRaw) {
  const clusterKey = normalizePlacementHubClusterKey(clusterRaw);
  const yearKey = resolveThresholdYearKey(yearRaw);
  const byYear = getOpenDreamMinLpaByYearSync();
  const yearMap = byYear[yearKey] ?? byYear[String(COMPANY_VISIT_DEFAULT_YEAR)];
  const lpa =
    yearMap?.[clusterKey] ??
    yearMap?.cs ??
    DEFAULT_OPEN_DREAM_MIN_LPA;
  return lpa * RUPEES_PER_LPA;
}

export async function getPlacementHubSettingsForApi() {
  await loadPlacementHubSettingsCache();
  return {
    openDreamMinLpaByYear: getOpenDreamMinLpaByYearSync(),
    years: [...PLACEMENT_OPEN_DREAM_SETTING_YEARS],
  };
}

/**
 * @param {Record<string, Record<string, unknown>>} updates — partial/full year → cluster → LPA
 */
export async function updatePlacementHubOpenDreamThresholds(updates) {
  const current = getOpenDreamMinLpaByYearSync();
  const next = { ...current };

  if (updates && typeof updates === "object") {
    for (const [yearKey, clusterMap] of Object.entries(updates)) {
      const y = normalizePlacementOpenDreamSettingYear(yearKey);
      if (y === undefined || !clusterMap || typeof clusterMap !== "object") continue;
      const merged = { ...(next[String(y)] || defaultOpenDreamMinLpaByCluster()) };
      for (const cluster of PLACEMENT_HUB_CLUSTER_KEYS) {
        if (clusterMap[cluster] != null) {
          merged[cluster] = normalizeMinLpa(clusterMap[cluster]);
        }
      }
      next[String(y)] = merged;
    }
  }

  const doc = await PlacementHubSettings.findOneAndUpdate(
    { settingsKey: SETTINGS_DOC_KEY },
    {
      $set: { openDreamMinLpaByYear: next },
      $unset: { openDreamMinLpaByCluster: "" },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();

  applyCacheFromDoc(doc);
  return getOpenDreamMinLpaByYearSync();
}
