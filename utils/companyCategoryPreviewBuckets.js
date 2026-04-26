/**
 * Mirrors category bucketing in `RV-placements-frontend/src/components/CompanyStats.jsx`
 * (placementTier === null, 2026 CS category tiles).
 */

const PLACEMENT_CATEGORY_OPEN_DREAM = "open dream";

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
  const allSummer = orderedCompanies.filter(
    (c) => isPpoCompany(c) && !isOffCampusCompany(c)
  );
  const allOff = orderedCompanies.filter(isOffCampusCompany);
  const allInternshipOnly = orderedCompanies.filter(
    (c) =>
      isInternshipOnlyCompany(c) &&
      !isPpoCompany(c) &&
      !isOffCampusCompany(c)
  );
  const allDream = orderedCompanies.filter(
    (c) =>
      !isOffCampusCompany(c) &&
      !isPpoCompany(c) &&
      c.category !== PLACEMENT_CATEGORY_OPEN_DREAM &&
      !isInternshipOnlyCompany(c)
  );
  const allOpenDream = orderedCompanies.filter(
    (c) =>
      !isOffCampusCompany(c) &&
      !isPpoCompany(c) &&
      c.category === PLACEMENT_CATEGORY_OPEN_DREAM &&
      !isInternshipOnlyCompany(c)
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
