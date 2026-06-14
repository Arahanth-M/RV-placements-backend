/**
 * Mirrors category bucketing in `RV-placements-frontend/src/components/CompanyStats.jsx`
 * (placementTier === null, 2026 CS category tiles).
 */

import { getCompanyPlacementMeta } from "./ctcCategory.js";
import { getOpenDreamMinRupeesForClusterSync } from "../services/placementHubSettingsService.js";
import { COMPANY_VISIT_DEFAULT_YEAR } from "./placementYears.js";
import { COMPANY_DETAIL_VISIT_YEARS } from "./placementYears.js";
import { sortCompaniesByVisitDate } from "./visitDateSort.js";

const PLACEMENT_CATEGORY_OPEN_DREAM = "open dream";

/** @param {unknown} raw */
function normalizePlacementDetailYear(raw) {
  const y = Number(raw);
  return Number.isFinite(y) && COMPANY_DETAIL_VISIT_YEARS.includes(y) ? y : undefined;
}

/** Normalizes company/visit `type` strings for comparisons (same rules as list filters). */
export function normalizeType(type) {
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

/** On-campus FTE / internship+FTE visit types — never treat as stipend-only internship hub rows. */
function isFtePlacementType(typeRaw) {
  const norm = normalizeType(typeRaw);
  if (norm === "fte") return true;
  return norm.includes("internship") && norm.includes("fte");
}

function isInternshipOnlyCompany(company) {
  if (isFtePlacementType(company?.type)) return false;
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
  if (!visit || typeof visit !== "object") return false;
  if (normalizeType(visit?.type).includes("ppo")) return true;
  // Some legacy rows put the PPO marker on `cluster` only.
  if (normalizeType(visit?.cluster).includes("ppo")) return true;
  return false;
}

/** @param {Record<string, unknown>|null|undefined} visit */
export function visitIsMarkedOffCampus(visit) {
  return visit?.offCampus === true;
}

/**
 * Summer-internship hub row: on-campus PPO only — not combined FTE offers (`Internship+FTE`, etc.).
 * Matches {@link visitIsPpo} but rejects `type` strings that imply an FTE package track.
 */
export function visitQualifiesSummerInternshipListingRow(visit) {
  if (!visit || typeof visit !== "object") return false;
  if (!visitIsPpo(visit) || visitIsMarkedOffCampus(visit)) return false;
  const norm = normalizeType(visit?.type);
  if (norm.includes("fte")) return false;
  return true;
}

/** True if any approved visit qualifies for the Summer internship tile (strict PPO-only row). */
export function companyHasAnyYearSummerInternshipListingFromVisits(visits) {
  if (!Array.isArray(visits)) return false;
  return visits.some((v) => visitQualifiesSummerInternshipListingRow(v));
}

/** Single approved row qualifies for Dream / Open dream merge slot (non-PPO FTE-style). */
export function visitQualifiesDreamTierRow(visit) {
  if (!visit || typeof visit !== "object") return false;
  if (visitIsMarkedOffCampus(visit) || visitIsPpo(visit)) return false;
  if (isFtePlacementType(visit?.type)) return true;
  return !isInternshipOnlyCompany({ roles: visit.roles, type: visit?.type });
}

/**
 * Dream / Open dream **hub list** eligibility for one visit row.
 * Includes strict dream-tier rows plus on-campus PPO-labelled rows that still carry an FTE/combined package
 * (same hybrids {@link getListPlacementCategoryMetaFromVisits} can label as FTE).
 * Excludes strict summer-internship-only rows so those stay summer-hub-only.
 */
export function visitQualifiesDreamHubListingVisit(visit) {
  if (!visit || typeof visit !== "object") return false;
  if (visitIsMarkedOffCampus(visit)) return false;
  if (visitQualifiesDreamTierRow(visit)) return true;
  if (
    visitIsPpo(visit) &&
    rolesSuggestFtePackage(visit) &&
    !visitQualifiesSummerInternshipListingRow(visit)
  ) {
    return true;
  }
  return false;
}

/**
 * Internship-only hub row: visit type is 6-month internship-only, or roles match internship-only (stipend, no CTC).
 * Excludes PPO and off-campus (mirrors {@link CompanyStats} internship-only slice).
 */
export function visitQualifiesInternshipOnlyHubRow(visit) {
  if (!visit || typeof visit !== "object") return false;
  if (visitIsMarkedOffCampus(visit)) return false;
  if (visitIsPpo(visit)) return false;
  if (isFtePlacementType(visit?.type)) return false;
  const norm = normalizeType(visit?.type);
  if (norm.includes("onlyinternship")) return true;
  if (norm.includes("only") && norm.includes("internship")) return true;
  return isInternshipOnlyCompany({ roles: visit.roles });
}

/** Approved row for `placementYear` is on-campus 6-month internship-only (not PPO / FTE). */
export function hasInternshipOnlyVisitForYear(allVisits, placementYear) {
  const y = normalizePlacementDetailYear(placementYear);
  if (y === undefined || !Array.isArray(allVisits)) return false;
  return allVisits.some(
    (v) =>
      normalizePlacementDetailYear(v?.year) === y &&
      visitQualifiesInternshipOnlyHubRow(v)
  );
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
 * True if any approved visit should appear on Dream / Open dream hub lists
 * ({@link visitQualifiesDreamHubListingVisit} — strict dream tier or FTE-heavy hybrid rows).
 * Per-year “did they visit this cycle?” remains {@link hasDreamTierVisitForYear} / placementDreamTierForListingYear.
 * @param {Record<string, unknown>[]|undefined} visits
 */
export function companyHasDreamTierVisitFromVisits(visits) {
  if (!Array.isArray(visits)) return false;
  return visits.some((v) => visitQualifiesDreamHubListingVisit(v));
}

/** @param {Record<string, unknown>|null|undefined} visit */
function visitDisplayType(visit) {
  const t = visit?.type;
  if (typeof t !== "string") return undefined;
  const s = t.trim();
  return s || undefined;
}

/**
 * @param {Record<string, unknown>[]} dreamTiers — non-empty
 * @param {number} openDreamMinRupees
 * @returns {Record<string, unknown>}
 */
function pickBestDreamTierVisitByCtc(dreamTiers, openDreamMinRupees) {
  const metaOpts = { openDreamMinRupees };
  let bestIdx = 0;
  let best = getCompanyPlacementMeta({ roles: dreamTiers[0].roles }, metaOpts);
  for (let i = 1; i < dreamTiers.length; i++) {
    const m = getCompanyPlacementMeta({ roles: dreamTiers[i].roles }, metaOpts);
    if (m.totalCtcRupees > best.totalCtcRupees) {
      best = m;
      bestIdx = i;
    }
  }
  return dreamTiers[bestIdx];
}

/**
 * Dream/Open dream card subtitle source — matches hub-eligible rows but never strict Summer internship (`Internship(PPO)`).
 */
function pickDreamHubSubtitleVisitAcrossYears(list, openDreamMinRupees) {
  if (!Array.isArray(list) || list.length === 0) return null;
  for (const y of COMPANY_DETAIL_VISIT_YEARS) {
    const scoped = list.filter(
      (v) => Number(v.year) === y && visitQualifiesDreamTierRow(v)
    );
    if (scoped.length > 0) return pickBestDreamTierVisitByCtc(scoped, openDreamMinRupees);
    const hybrid = list.find(
      (v) =>
        Number(v.year) === y &&
        visitIsPpo(v) &&
        !visitIsMarkedOffCampus(v) &&
        rolesSuggestFtePackage(v) &&
        !visitQualifiesSummerInternshipListingRow(v)
    );
    if (hybrid) return hybrid;
  }
  return (
    list.find(
      (v) =>
        visitQualifiesDreamHubListingVisit(v) &&
        !visitQualifiesSummerInternshipListingRow(v)
    ) ?? null
  );
}

/**
 * PPO row still carries an FTE/on-campus placement angle (package data or “+ FTE” in type).
 */
function rolesSuggestFtePackage(visit) {
  const norm = normalizeType(visit?.type);
  if (norm.includes("fte")) return true;
  if (!Array.isArray(visit?.roles) || visit.roles.length === 0) return false;
  if (!isInternshipOnlyCompany({ roles: visit.roles })) return true;
  return getCompanyPlacementMeta({ roles: visit.roles }).totalCtcRupees > 0;
}

/**
 * Summer tile: strict internship(PPO)-only visits; optional listing year narrows the pool first.
 * @returns {{ displayType?: string, detailYear?: number }}
 * @param {Record<string, unknown>[]|undefined} visits
 * @param {unknown} [preferredListingYear] — optional `?year=` on hub lists (2026 / 2027)
 */
export function getSummerPlacementPrefFromVisits(visits, preferredListingYear) {
  if (!Array.isArray(visits)) return { displayType: undefined, detailYear: undefined };
  let pool = visits.filter((v) => visitQualifiesSummerInternshipListingRow(v));
  if (pool.length === 0) return { displayType: undefined, detailYear: undefined };

  const prefYear = normalizePlacementDetailYear(preferredListingYear);
  if (prefYear !== undefined) {
    const scoped = pool.filter(
      (v) => normalizePlacementDetailYear(v?.year) === prefYear
    );
    if (scoped.length > 0) pool = scoped;
  }

  pool.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
  const v = pool[0];
  return {
    displayType: visitDisplayType(v),
    detailYear: normalizePlacementDetailYear(v?.year),
  };
}

/**
 * Internship-only tile: strict 6-month rows; optional listing year narrows the pool first.
 * @returns {{ displayType?: string, detailYear?: number }}
 */
export function getInternshipOnlyPlacementPrefFromVisits(visits, preferredListingYear) {
  if (!Array.isArray(visits)) return { displayType: undefined, detailYear: undefined };
  let pool = visits.filter((v) => visitQualifiesInternshipOnlyHubRow(v));
  if (pool.length === 0) return { displayType: undefined, detailYear: undefined };

  const prefYear = normalizePlacementDetailYear(preferredListingYear);
  if (prefYear !== undefined) {
    const scoped = pool.filter(
      (v) => normalizePlacementDetailYear(v?.year) === prefYear
    );
    if (scoped.length === 0) {
      return { displayType: undefined, detailYear: undefined };
    }
    pool = scoped;
  }

  pool.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
  const v = pool[0];
  return {
    displayType: visitDisplayType(v),
    detailYear: normalizePlacementDetailYear(v?.year),
  };
}

/**
 * Dream vs open-dream from the best qualifying (non-PPO, on-campus, not internship-only) visit.
 * Falls back to primary visit meta when no such visit exists.
 *
 * When `preferredListingYear` is set (2026/2027/2028 hub year), dream/open-dream **card labels**
 * prefer that year's qualifying visit so Open Dream matches per-year placement rows (not an older year's type).
 * If that cycle has no strict dream-tier row nor hybrid FTE row, **later cycles** in
 * {@link COMPANY_DETAIL_VISIT_YEARS} are tried in order (e.g. 2026 → 2027 → 2028).
 * Card subtitles use each chosen visit row’s stored **`type`** string (trimmed), including hybrid PPO rows (e.g. `Internship+FTE`).
 * Strict summer internship rows (`Internship(PPO)`, etc.) never headline Dream/Open dream — those belong on the Summer internship hub.
 *
 * @returns {{ category: string, totalCtcRupees: number, dreamDisplayType?: string, dreamDetailYear?: number }}
 * @param {Record<string, unknown>[]|undefined} visits
 * @param {Record<string, unknown>|null|undefined} primaryVisit
 * @param {unknown} [preferredListingYear] — optional `?year=` when rendering lists (2026 / 2027)
 * @param {unknown} [clusterKey] — hub cluster (`cs` / `ec` / `me` / `chem`) for Open dream LPA threshold
 */
export function getListPlacementCategoryMetaFromVisits(
  visits,
  primaryVisit,
  preferredListingYear,
  clusterKey = "cs"
) {
  const list = Array.isArray(visits) ? visits : [];
  const prefYear = normalizePlacementDetailYear(preferredListingYear);
  const yearForThreshold =
    prefYear ??
    normalizePlacementDetailYear(primaryVisit?.year) ??
    COMPANY_VISIT_DEFAULT_YEAR;
  const openDreamMinRupees = getOpenDreamMinRupeesForClusterSync(
    clusterKey,
    yearForThreshold
  );
  const metaOpts = { openDreamMinRupees };
  const dreamTiers = list.filter((v) => visitQualifiesDreamTierRow(v));

  const bestGlobalVisit =
    dreamTiers.length > 0
      ? pickBestDreamTierVisitByCtc(dreamTiers, openDreamMinRupees)
      : null;

  /** Category / bucket CTC stay driven by the best dream-tier package across years (existing behaviour). */
  const globalMeta = bestGlobalVisit
    ? getCompanyPlacementMeta({ roles: bestGlobalVisit.roles }, metaOpts)
    : getCompanyPlacementMeta({ roles: primaryVisit?.roles }, metaOpts);

  /** Visit whose `type` string drives the Dream / Open dream card subtitle for this listing. */
  let displayVisit = null;
  /** Hybrid FTE-style row resolved when scanning listing year → later cycles (same order as strict tiers). */
  let hybridFallbackVisit = null;
  let hybridFallbackYear;

  if (prefYear !== undefined && list.length > 0) {
    const startIdx = COMPANY_DETAIL_VISIT_YEARS.indexOf(prefYear);
    const yearsToTry =
      startIdx >= 0 ? COMPANY_DETAIL_VISIT_YEARS.slice(startIdx) : [prefYear];
    for (const y of yearsToTry) {
      const scoped = dreamTiers.filter((v) => Number(v.year) === y);
      if (scoped.length > 0) {
        displayVisit = pickBestDreamTierVisitByCtc(scoped, openDreamMinRupees);
        break;
      }
      const hybridVisit = list.find(
        (v) =>
          Number(v.year) === y &&
          visitIsPpo(v) &&
          !visitIsMarkedOffCampus(v) &&
          rolesSuggestFtePackage(v) &&
          !visitQualifiesSummerInternshipListingRow(v)
      );
      if (hybridVisit) {
        hybridFallbackVisit = hybridVisit;
        hybridFallbackYear = y;
        break;
      }
    }
  }

  let dreamDisplayType;
  let dreamDetailYear;
  let dreamSubtitleVisit = null;

  if (displayVisit) {
    dreamSubtitleVisit = displayVisit;
    dreamDisplayType = visitDisplayType(displayVisit);
    dreamDetailYear = normalizePlacementDetailYear(displayVisit.year);
  } else if (
    hybridFallbackVisit != null &&
    hybridFallbackYear !== undefined
  ) {
    dreamSubtitleVisit = hybridFallbackVisit;
    dreamDisplayType = visitDisplayType(hybridFallbackVisit);
    dreamDetailYear = hybridFallbackYear;
  } else if (prefYear !== undefined) {
    const subtitleVisit =
      primaryVisit &&
      !visitQualifiesSummerInternshipListingRow(primaryVisit)
        ? primaryVisit
        : pickDreamHubSubtitleVisitAcrossYears(list, openDreamMinRupees);
    if (
      subtitleVisit &&
      !visitQualifiesSummerInternshipListingRow(subtitleVisit)
    ) {
      dreamSubtitleVisit = subtitleVisit;
    }
    dreamDisplayType = subtitleVisit
      ? visitDisplayType(subtitleVisit)
      : undefined;
    dreamDetailYear = subtitleVisit
      ? normalizePlacementDetailYear(subtitleVisit.year)
      : prefYear;
  } else if (bestGlobalVisit) {
    dreamSubtitleVisit = bestGlobalVisit;
    dreamDisplayType = visitDisplayType(bestGlobalVisit);
    dreamDetailYear = normalizePlacementDetailYear(bestGlobalVisit.year);
  } else {
    const subtitleVisit =
      primaryVisit &&
      !visitQualifiesSummerInternshipListingRow(primaryVisit)
        ? primaryVisit
        : pickDreamHubSubtitleVisitAcrossYears(list, openDreamMinRupees);
    if (
      subtitleVisit &&
      !visitQualifiesSummerInternshipListingRow(subtitleVisit)
    ) {
      dreamSubtitleVisit = subtitleVisit;
    }
    dreamDisplayType = subtitleVisit
      ? visitDisplayType(subtitleVisit)
      : undefined;
    dreamDetailYear = subtitleVisit
      ? normalizePlacementDetailYear(subtitleVisit.year)
      : normalizePlacementDetailYear(primaryVisit?.year);
  }

  const dreamDateOfVisit =
    dreamSubtitleVisit?.date_of_visit == null
      ? ""
      : String(dreamSubtitleVisit.date_of_visit).trim();

  return {
    ...globalMeta,
    dreamDisplayType,
    dreamDetailYear,
    dreamDateOfVisit,
  };
}

/**
 * Label under the company name on GET `/companies/:id?year=` when the stored visit `type` is PPO-heavy
 * but that year’s row includes FTE roles — matches Dream/Open-dream card wording without mutating stored `type`.
 *
 * Only switches away from raw `type` when {@link getListPlacementCategoryMetaFromVisits} resolves the label to this year (`dreamDetailYear ===` requested year).
 *
 * @param {Record<string, unknown>[]|undefined} visits — approved visits for this company (2026/2027)
 * @param {Record<string, unknown>|null|undefined} visitForYear — visit row for `placementYear`, plain `roles[].ctc`
 * @param {unknown} placementYearRaw
 * @param {unknown} [placementListContextRaw] — when `summer_internship`, never substitute Dream hybrid headlines for the visit `type` string.
 * @returns {string|undefined}
 */
export function getCompanyDetailHeadlineTypeFromVisits(
  visits,
  visitForYear,
  placementYearRaw,
  placementListContextRaw,
  clusterKey = "cs"
) {
  if (!visitForYear || typeof visitForYear !== "object") return undefined;
  const raw =
    typeof visitForYear.type === "string" ? visitForYear.type.trim() : "";
  const ctx =
    typeof placementListContextRaw === "string"
      ? placementListContextRaw.trim().toLowerCase().replace(/-/g, "_")
      : "";
  if (
    ctx === "summer_internship" ||
    ctx === "internship_only" ||
    ctx === "off_campus"
  ) {
    return raw || undefined;
  }
  const pref = normalizePlacementDetailYear(placementYearRaw);
  if (pref === undefined) return raw || undefined;

  const meta = getListPlacementCategoryMetaFromVisits(
    visits,
    visitForYear,
    pref,
    clusterKey
  );
  if (meta.dreamDisplayType && meta.dreamDetailYear === pref) {
    return meta.dreamDisplayType;
  }
  return raw || undefined;
}

function summerTileEligibleCompany(c) {
  if (c.placementSummerInternshipForListingYear === true) return true;
  if (c.placementSummerInternshipForListingYear === false) return false;
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
/**
 * @param {Record<string, unknown>[]} companies
 * @param {{ defaultYear?: number }} [options]
 */
export function sortCompaniesForCategoryPreview(companies, options = {}) {
  return sortCompaniesByVisitDate(companies, { ...options, hub: options.hub ?? "dream" });
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
