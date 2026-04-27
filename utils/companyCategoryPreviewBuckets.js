/**
 * Mirrors category bucketing in `RV-placements-frontend/src/components/CompanyStats.jsx`
 * (placementTier === null, 2026 CS category tiles).
 */

import { getCompanyPlacementMeta } from "./ctcCategory.js";

const PLACEMENT_CATEGORY_OPEN_DREAM = "open dream";

/** @param {unknown} raw */
function normalizePlacementDetailYear(raw) {
  const y = Number(raw);
  return Number.isFinite(y) && (y === 2026 || y === 2027) ? y : undefined;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toTimestamp(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return raw.length <= 10 ? n * 1000 : n;
  }

  let ts = Date.parse(raw);
  if (!Number.isNaN(ts)) return ts;

  const noOrdinal = raw.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
  ts = Date.parse(noOrdinal);
  if (!Number.isNaN(ts)) return ts;

  const dmy = noOrdinal.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const date = new Date(year, month, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month &&
      date.getDate() === day
    ) {
      return date.getTime();
    }
  }

  return null;
}

function normalizeType(type) {
  return String(type || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function ctcObjectFromRole(ctc) {
  if (ctc == null) return null;
  if (typeof ctc !== "object" || Array.isArray(ctc)) return null;
  if (typeof ctc.get === "function" && typeof ctc.entries === "function") {
    try {
      return Object.fromEntries(ctc);
    } catch {
      return null;
    }
  }
  return ctc;
}

function isCtcValueVacuous(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized === "" || normalized === "0";
  }
  if (typeof value === "number") return !Number.isFinite(value) || value === 0;
  return false;
}

function isCtcObjectEmpty(ctc) {
  const obj = ctcObjectFromRole(ctc);
  if (!obj) return true;
  const keys = Object.keys(obj);
  if (keys.length === 0) return true;
  return keys.every((k) => isCtcValueVacuous(obj[k]));
}

function hasNonEmptyCtcStringInCompany(company) {
  if (!Array.isArray(company?.roles)) return false;
  for (const role of company.roles) {
    const obj = ctcObjectFromRole(role?.ctc);
    if (!obj) continue;
    for (const v of Object.values(obj)) {
      if (typeof v !== "string") continue;
      const normalized = v.trim();
      if (normalized !== "" && normalized !== "0") return true;
    }
  }
  return false;
}

function isInternshipOnlyCompany(company) {
  if (!Array.isArray(company?.roles) || company.roles.length === 0) return false;
  if (hasNonEmptyCtcStringInCompany(company)) return false;
  if (!company.roles.every((role) => isCtcObjectEmpty(role?.ctc))) return false;
  return company.roles.some((role) => Number(role?.internshipStipend) > 0);
}

function isPpoCompany(company) {
  return normalizeType(company?.type).includes("ppo");
}

function isOffCampusCompany(company) {
  return company?.offCampus === true;
}

/** @param {Record<string, unknown>|null|undefined} visit */
export function visitIsPpo(visit) {
  return normalizeType(visit?.type).includes("ppo");
}

/** @param {Record<string, unknown>|null|undefined} visit */
export function visitIsMarkedOffCampus(visit) {
  return visit?.offCampus === true;
}

/**
 * True if any approved visit is an on-campus PPO (summer-internship tile).
 * @param {Record<string, unknown>[]|undefined} visits
 */
export function companyHasAnyYearSummerPpoFromVisits(visits) {
  if (!Array.isArray(visits)) return false;
  return visits.some((v) => visitIsPpo(v) && !visitIsMarkedOffCampus(v));
}

/**
 * True if any approved visit belongs in Dream / Open dream (non-PPO FTE-style visit).
 * @param {Record<string, unknown>[]|undefined} visits
 */
export function companyHasDreamTierVisitFromVisits(visits) {
  if (!Array.isArray(visits)) return false;
  return visits.some(
    (v) =>
      !visitIsPpo(v) &&
      !visitIsMarkedOffCampus(v) &&
      !isInternshipOnlyCompany({ roles: v.roles })
  );
}

/** @param {Record<string, unknown>|null|undefined} visit */
function visitDisplayType(visit) {
  const t = visit?.type;
  if (typeof t !== "string") return undefined;
  const s = t.trim();
  return s || undefined;
}

/**
 * Summer tile: latest on-campus PPO visit wins (display type + detail year for deep links).
 * @returns {{ displayType?: string, detailYear?: number }}
 * @param {Record<string, unknown>[]|undefined} visits
 */
export function getSummerPlacementPrefFromVisits(visits) {
  if (!Array.isArray(visits)) return { displayType: undefined, detailYear: undefined };
  const ppo = visits.filter((v) => visitIsPpo(v) && !visitIsMarkedOffCampus(v));
  if (ppo.length === 0) return { displayType: undefined, detailYear: undefined };
  ppo.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
  const v = ppo[0];
  return {
    displayType: visitDisplayType(v),
    detailYear: normalizePlacementDetailYear(v?.year),
  };
}

/**
 * Dream vs open-dream from the best qualifying (non-PPO, on-campus, not internship-only) visit.
 * Falls back to primary visit meta when no such visit exists.
 * @returns {{ category: string, totalCtcRupees: number, dreamDisplayType?: string, dreamDetailYear?: number }}
 * @param {Record<string, unknown>[]|undefined} visits
 * @param {Record<string, unknown>|null|undefined} primaryVisit
 */
export function getListPlacementCategoryMetaFromVisits(visits, primaryVisit) {
  const list = Array.isArray(visits) ? visits : [];
  const dreamTiers = list.filter(
    (v) =>
      !visitIsPpo(v) &&
      !visitIsMarkedOffCampus(v) &&
      !isInternshipOnlyCompany({ roles: v.roles })
  );
  if (dreamTiers.length === 0) {
    const meta = getCompanyPlacementMeta({ roles: primaryVisit?.roles });
    return {
      ...meta,
      dreamDisplayType: visitDisplayType(primaryVisit),
      dreamDetailYear: normalizePlacementDetailYear(primaryVisit?.year),
    };
  }
  let bestIdx = 0;
  let best = getCompanyPlacementMeta({ roles: dreamTiers[0].roles });
  for (let i = 1; i < dreamTiers.length; i++) {
    const m = getCompanyPlacementMeta({ roles: dreamTiers[i].roles });
    if (m.totalCtcRupees > best.totalCtcRupees) {
      best = m;
      bestIdx = i;
    }
  }
  return {
    ...best,
    dreamDisplayType: visitDisplayType(dreamTiers[bestIdx]),
    dreamDetailYear: normalizePlacementDetailYear(dreamTiers[bestIdx]?.year),
  };
}

function summerTileEligibleCompany(c) {
  if (c.placementAnyYearPpoOnCampus === true) return true;
  if (c.placementAnyYearPpoOnCampus === false) return false;
  return isPpoCompany(c) && !isOffCampusCompany(c);
}

function dreamTileBaseCompany(c) {
  if (c.placementHasDreamTierVisit === true) return !isOffCampusCompany(c);
  if (c.placementHasDreamTierVisit === false) return false;
  return (
    !isOffCampusCompany(c) &&
    !isPpoCompany(c) &&
    !isInternshipOnlyCompany(c)
  );
}

/**
 * @param {Record<string, unknown>[]} companies — already `attachPlacementCategoryToCompany`’d
 * @returns {Record<string, unknown>[]}
 */
export function sortCompaniesForCategoryPreview(companies) {
  return [...companies].sort((a, b) => {
    const aMessageTs = toTimestamp(
      a?.messageDate ?? a?.messagedate ?? a?.message_date
    );
    const bMessageTs = toTimestamp(
      b?.messageDate ?? b?.messagedate ?? b?.message_date
    );

    if (aMessageTs !== null && bMessageTs !== null) return aMessageTs - bMessageTs;
    if (aMessageTs !== null) return -1;
    if (bMessageTs !== null) return 1;

    const aUpdatedTs = toTimestamp(a?.updatedAt) ?? toTimestamp(a?.createdAt) ?? 0;
    const bUpdatedTs = toTimestamp(b?.updatedAt) ?? toTimestamp(b?.createdAt) ?? 0;
    if (aUpdatedTs !== bUpdatedTs) return aUpdatedTs - bUpdatedTs;

    return (a?.name || "").localeCompare(b?.name || "");
  });
}

function toLogoItem(c) {
  return {
    _id: c._id,
    name: c.name,
    logo: c.logo,
    category: c.category,
  };
}

/**
 * @param {Record<string, unknown>[]} orderedCompanies
 * @param {number} [logoLimit]
 * @returns {{ counts: object, logos: object }}
 */
export function buildCategoryPreviewResponse(orderedCompanies, logoLimit = 5) {
  const allSummer = orderedCompanies.filter((c) => summerTileEligibleCompany(c));
  const allOff = orderedCompanies.filter(isOffCampusCompany);
  const allInternshipOnly = orderedCompanies.filter(
    (c) =>
      isInternshipOnlyCompany(c) &&
      !isPpoCompany(c) &&
      !isOffCampusCompany(c)
  );
  const allDream = orderedCompanies.filter(
    (c) =>
      dreamTileBaseCompany(c) &&
      c.category !== PLACEMENT_CATEGORY_OPEN_DREAM
  );
  const allOpenDream = orderedCompanies.filter(
    (c) =>
      dreamTileBaseCompany(c) &&
      c.category === PLACEMENT_CATEGORY_OPEN_DREAM
  );

  return {
    counts: {
      dream: allDream.length,
      openDream: allOpenDream.length,
      internshipOnly: allInternshipOnly.length,
      summerInternship: allSummer.length,
      offCampus: allOff.length,
    },
    logos: {
      dream: allDream.slice(0, logoLimit).map(toLogoItem),
      openDream: allOpenDream.slice(0, logoLimit).map(toLogoItem),
      internshipOnly: allInternshipOnly.slice(0, logoLimit).map(toLogoItem),
      summerInternship: allSummer.slice(0, logoLimit).map(toLogoItem),
      offCampus: allOff.slice(0, logoLimit).map(toLogoItem),
    },
  };
}
