/**
 * Parse free-text `date_of_visit` strings for stable chronological sorting.
 * Handles ranges (13–18th October), fuzzy phrases (mid September), and common admin formats.
 */

const MONTH_INDEX = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sept: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const MONTH_PATTERN =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b/i;

const PLACEHOLDER_RE = /^(tba|tbd|na|n\/a|pending|to be (?:announced|decided)|not (?:set|available))$/i;

/**
 * @param {string} raw
 * @returns {number|undefined}
 */
function extractExplicitYear(raw) {
  const m = raw.match(/\b(20\d{2})\b/);
  if (!m) return undefined;
  const y = Number(m[1]);
  return Number.isFinite(y) ? y : undefined;
}

/**
 * @param {string} normalized
 * @returns {number|undefined} 0–11
 */
function extractMonthIndex(normalized) {
  const m = normalized.match(MONTH_PATTERN);
  if (!m) return undefined;
  return MONTH_INDEX[m[1].toLowerCase()];
}

/**
 * @param {string} normalized
 * @returns {number|undefined} 1–31
 */
function inferDayFromFuzzyWords(normalized) {
  if (/\bearly\b/.test(normalized)) return 7;
  if (/\bmid(?:dle)?\b/.test(normalized)) return 15;
  if (/\blate\b/.test(normalized)) return 22;
  if (/\bend\b/.test(normalized)) return 28;
  if (/\bfirst\s+week\b/.test(normalized)) return 4;
  if (/\bsecond\s+week\b/.test(normalized)) return 11;
  if (/\bthird\s+week\b/.test(normalized)) return 18;
  if (/\bfourth\s+week\b/.test(normalized)) return 25;
  if (/\b1st\s+half\b/.test(normalized)) return 7;
  if (/\b2nd\s+half\b|\bsecond\s+half\b/.test(normalized)) return 22;
  return undefined;
}

/**
 * @param {string} normalized
 * @returns {number|undefined}
 */
function extractRangeStartDay(normalized) {
  const range = normalized.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*[-–—&]\s*(\d{1,2})\b/);
  if (range) {
    const day = Number(range[1]);
    if (day >= 1 && day <= 31) return day;
  }
  const toRange = normalized.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+to\s+(\d{1,2})\b/);
  if (toRange) {
    const day = Number(toRange[1]);
    if (day >= 1 && day <= 31) return day;
  }
  return undefined;
}

/**
 * @param {string} normalized
 * @param {number|undefined} monthIndex
 * @param {number|undefined} explicitYear
 * @returns {number|undefined}
 */
function extractSingleDay(normalized, monthIndex, explicitYear) {
  const rangeStart = extractRangeStartDay(normalized);
  if (rangeStart != null) return rangeStart;

  const fuzzy = inferDayFromFuzzyWords(normalized);
  if (fuzzy != null) return fuzzy;

  const dayMatches = normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/g);
  if (!dayMatches) return undefined;

  for (const token of dayMatches) {
    const digits = token.match(/(\d{1,2})/);
    if (!digits) continue;
    const day = Number(digits[1]);
    if (day < 1 || day > 31) continue;
    if (explicitYear != null && day === explicitYear) continue;
    if (monthIndex != null && day === monthIndex + 1) continue;
    return day;
  }
  return undefined;
}

/**
 * @param {number} year
 * @param {number} monthIndex
 * @param {number} day
 * @returns {number|null}
 */
function buildTimestamp(year, monthIndex, day) {
  const date = new Date(year, monthIndex, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

/**
 * Prefer explicit calendar year from the date text; otherwise use the visit/hub year.
 * @param {number|undefined} explicitYear
 * @param {number} defaultYear
 */
function resolveVisitSortYear(explicitYear, defaultYear) {
  if (explicitYear != null && Number.isFinite(explicitYear)) {
    return explicitYear;
  }
  return defaultYear;
}

/**
 * @param {unknown} value
 * @param {{ defaultYear?: number }} [options]
 * @returns {number|null}
 */
export function parseVisitDateToTimestamp(value, options = {}) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return null;
    return value >= 100_000_000_000 ? value : value * 1000;
  }

  const raw = String(value).trim();
  if (!raw || PLACEHOLDER_RE.test(raw)) return null;

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return raw.length <= 10 ? n * 1000 : n;
  }

  const noOrdinal = raw.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
  const normalized = noOrdinal.replace(/\s+/g, " ").trim().toLowerCase();

  const iso = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return buildTimestamp(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const dmy = normalized.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const monthIndex = Number(dmy[2]) - 1;
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    return buildTimestamp(year, monthIndex, day);
  }

  const monthIndex = extractMonthIndex(normalized);
  if (monthIndex != null) {
    const explicitYear = extractExplicitYear(raw);
    const defaultYear =
      Number.isFinite(options.defaultYear) && options.defaultYear > 0
        ? options.defaultYear
        : new Date().getFullYear();
    const year = resolveVisitSortYear(explicitYear, defaultYear);
    const day = extractSingleDay(normalized, monthIndex, explicitYear) ?? 15;
    return buildTimestamp(year, monthIndex, day);
  }

  let ts = Date.parse(raw);
  if (!Number.isNaN(ts)) return ts;

  ts = Date.parse(noOrdinal);
  if (!Number.isNaN(ts)) return ts;

  return null;
}

/**
 * @param {Record<string, unknown>|null|undefined} company
 * @param {number|undefined} hubDefaultYear
 * @returns {number}
 */
export function resolveCompanyVisitSortYear(company, hubDefaultYear) {
  const hubYear =
    Number.isFinite(hubDefaultYear) && hubDefaultYear > 0
      ? hubDefaultYear
      : new Date().getFullYear();
  const visitYear = Number(company?.placementVisitYear ?? company?.year);
  if (Number.isFinite(visitYear) && visitYear > 2000) return visitYear;
  const detailYear = Number(
    company?.placementDreamDetailYear ?? company?.placementSummerDetailYear
  );
  if (Number.isFinite(detailYear) && detailYear > 2000) return detailYear;
  return hubYear;
}

export function resolveVisitSortDateAndYear(company, hub, hubDefaultYear) {
  if (!company || typeof company !== "object") {
    return { dateRaw: null, sortYear: hubDefaultYear };
  }

  let dateRaw = company.date_of_visit;
  let sortYear = resolveCompanyVisitSortYear(company, hubDefaultYear);

  if (hub === "summer_internship") {
    const summerDate = company.placementSummerDateOfVisit;
    if (summerDate != null && String(summerDate).trim() !== "") {
      dateRaw = summerDate;
      const y = Number(company.placementSummerDetailYear);
      if (Number.isFinite(y) && y > 2000) sortYear = y;
    }
  } else if (hub === "dream" || hub === "open_dream") {
    const dreamDate = company.placementDreamDateOfVisit;
    if (dreamDate != null && String(dreamDate).trim() !== "") {
      dateRaw = dreamDate;
      const y = Number(company.placementDreamDetailYear);
      if (Number.isFinite(y) && y > 2000) sortYear = y;
    } else if (company.placementDreamTierForListingYear === false) {
      return { dateRaw: null, sortYear };
    }
  } else if (hub === "internship_only") {
    const y = Number(company.placementInternshipOnlyDetailYear);
    if (Number.isFinite(y) && y > 2000) sortYear = y;
  }

  return { dateRaw, sortYear };
}

export function companyVisitSortTimestamp(company, options = {}) {
  if (!company || typeof company !== "object") return null;
  const { dateRaw, sortYear } = resolveVisitSortDateAndYear(
    company,
    options.hub,
    options.defaultYear
  );
  if (dateRaw == null) return null;
  return parseVisitDateToTimestamp(dateRaw, { defaultYear: sortYear });
}

/**
 * True when college-scoped got-in on the payload is positive
 * (placement total and/or PPO conversion got-in / branch rows).
 * @param {Record<string, unknown>|null|undefined} company
 * @returns {boolean}
 */
export function companyHasPositiveGotIn(company) {
  if (!company || typeof company !== "object") return false;
  const total = Number(company.totalGotIn);
  if (Number.isFinite(total) && total > 0) return true;
  const ppoTotal = Number(company.ppoConversionGotIn);
  if (Number.isFinite(ppoTotal) && ppoTotal > 0) return true;

  const sumGotIn = (rows) => {
    if (!Array.isArray(rows)) return 0;
    return rows.reduce((sum, row) => {
      const n = Number(/** @type {{ gotIn?: unknown }} */ (row)?.gotIn);
      return sum + (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
    }, 0);
  };

  if (sumGotIn(company.placementGotInBranchStats) > 0) return true;
  if (sumGotIn(company.ppoBranchStats) > 0) return true;
  return false;
}

export function compareCompaniesByVisitDate(a, b, options = {}) {
  if (options.prioritizeNonZeroGotIn === true) {
    const aHas = companyHasPositiveGotIn(a) ? 1 : 0;
    const bHas = companyHasPositiveGotIn(b) ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
  }

  const aVisitTs = companyVisitSortTimestamp(a, options);
  const bVisitTs = companyVisitSortTimestamp(b, options);

  if (aVisitTs !== null && bVisitTs !== null && aVisitTs !== bVisitTs) {
    return aVisitTs - bVisitTs;
  }
  if (aVisitTs !== null && bVisitTs === null) return -1;
  if (aVisitTs === null && bVisitTs !== null) return 1;

  const byName = (a?.name || "").localeCompare(b?.name || "");
  if (byName !== 0) return byName;
  const byCompanyId = String(a?._id || "").localeCompare(String(b?._id || ""));
  if (byCompanyId !== 0) return byCompanyId;
  return String(a?.placementCompanyVisitId || "").localeCompare(
    String(b?.placementCompanyVisitId || "")
  );
}

export function sortCompaniesByVisitDate(companies, options = {}) {
  return [...companies].sort((a, b) => compareCompaniesByVisitDate(a, b, options));
}
