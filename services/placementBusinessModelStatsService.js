import CompanyStatic from "../models/CompanyStatic.js";
import { normalizeTopCompanyName } from "./placementGeneralStatsImportService.js";

const NOT_SPECIFIED = "Not specified";

const CTC_RANGE_ORDER = ["< ₹10L", "₹10–20L", "₹20–30L", "₹30–50L", "> ₹50L", "Unknown"];

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeBusinessModelLabel(raw) {
  const value = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return value || NOT_SPECIFIED;
}

/**
 * Case/spacing-insensitive key for grouping the same business model label.
 * @param {unknown} raw
 * @returns {string}
 */
export function canonicalBusinessModelKey(raw) {
  const label = normalizeBusinessModelLabel(raw);
  if (label === NOT_SPECIFIED) return NOT_SPECIFIED;
  return label
    .toLowerCase()
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {Record<string, number>} ctcBuckets
 * @param {number} totalOffers
 * @returns {Array<{ range: string, offers: number, pct: number }>}
 */
export function buildCtcBreakdownForModel(ctcBuckets, totalOffers) {
  return CTC_RANGE_ORDER.map((range) => ({
    range,
    offers: Number(ctcBuckets?.[range]) || 0,
  }))
    .filter((row) => row.offers > 0)
    .sort((a, b) => {
      const orderA = CTC_RANGE_ORDER.indexOf(a.range);
      const orderB = CTC_RANGE_ORDER.indexOf(b.range);
      if (b.offers !== a.offers) return b.offers - a.offers;
      return orderA - orderB;
    })
    .map((row) => ({
      ...row,
      pct: totalOffers > 0 ? Math.round((row.offers / totalOffers) * 1000) / 10 : 0,
    }));
}

/**
 * @param {Record<string, number>} ctcBuckets
 * @returns {string}
 */
export function summarizeCtcRangeForModel(ctcBuckets) {
  const total = Object.values(ctcBuckets || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
  if (!total) return "—";

  const sorted = Object.entries(ctcBuckets || {})
    .map(([range, count]) => [range, Number(count) || 0])
    .filter(([, count]) => count > 0)
    .sort((a, b) => {
      const orderA = CTC_RANGE_ORDER.indexOf(a[0]);
      const orderB = CTC_RANGE_ORDER.indexOf(b[0]);
      if (b[1] !== a[1]) return b[1] - a[1];
      return (orderA === -1 ? 99 : orderA) - (orderB === -1 ? 99 : orderB);
    });

  if (!sorted.length) return "—";

  return sorted.map(([range, count]) => `${range} (${count})`).join(", ");
}

/**
 * @param {Array<{ name?: string, nameKey?: string, business_model?: string }>} rows
 */
function buildCompanyBusinessModelIndex(rows) {
  /** @type {Map<string, string>} */
  const exact = new Map();
  /** @type {Array<{ nameL: string, modelKey: string, displayModel: string }>} */
  const byName = [];
  /** @type {Map<string, number>} */
  const hubCountByModelKey = new Map();
  /** @type {Map<string, string>} */
  const displayModelByKey = new Map();
  /** @type {Map<string, number>} */
  const displayModelVotes = new Map();

  for (const row of rows) {
    const displayModel = normalizeBusinessModelLabel(row.business_model);
    const modelKey = canonicalBusinessModelKey(displayModel);
    hubCountByModelKey.set(modelKey, (hubCountByModelKey.get(modelKey) || 0) + 1);

    const voteKey = `${modelKey}\0${displayModel}`;
    displayModelVotes.set(voteKey, (displayModelVotes.get(voteKey) || 0) + 1);
    const currentBest = displayModelByKey.get(modelKey);
    const currentVotes = currentBest
      ? displayModelVotes.get(`${modelKey}\0${currentBest}`) || 0
      : 0;
    const nextVotes = displayModelVotes.get(voteKey) || 0;
    if (!currentBest || nextVotes > currentVotes) {
      displayModelByKey.set(modelKey, displayModel);
    }

    const name = String(row.name ?? "").trim();
    const nameKey = String(row.nameKey ?? "").trim();

    if (name) {
      const nameL = name.toLowerCase();
      const normalizedL = normalizeTopCompanyName(name).toLowerCase();
      exact.set(nameL, modelKey);
      exact.set(normalizedL, modelKey);
      byName.push({ nameL, modelKey, displayModel });
    }
    if (nameKey) {
      exact.set(nameKey.toLowerCase(), modelKey);
    }
  }

  byName.sort((a, b) => b.nameL.length - a.nameL.length);

  return {
    exact,
    byName,
    hubCountByModelKey,
    displayModelByKey,
  };
}

/**
 * @param {string} companyName
 * @param {ReturnType<typeof buildCompanyBusinessModelIndex>} index
 */
export function resolveBusinessModelForCompany(companyName, index) {
  const raw = String(companyName ?? "").trim();
  if (!raw) {
    return { modelKey: NOT_SPECIFIED, displayModel: NOT_SPECIFIED, matched: false };
  }

  const normalized = normalizeTopCompanyName(raw);
  const candidates = [raw.toLowerCase(), normalized.toLowerCase()];
  for (const key of candidates) {
    if (index.exact.has(key)) {
      const modelKey = index.exact.get(key);
      return {
        modelKey,
        displayModel: index.displayModelByKey.get(modelKey) || modelKey,
        matched: true,
      };
    }
  }

  const query = normalized.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const entry of index.byName) {
    if (query === entry.nameL) {
      return {
        modelKey: entry.modelKey,
        displayModel: index.displayModelByKey.get(entry.modelKey) || entry.displayModel,
        matched: true,
      };
    }

    const minLen = Math.min(query.length, entry.nameL.length);
    if (minLen < 4) continue;

    const includes =
      (query.length >= 6 && entry.nameL.includes(query)) ||
      (entry.nameL.length >= 6 && query.includes(entry.nameL));
    if (!includes) continue;

    const score = minLen + (query === entry.nameL ? 1000 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  if (bestMatch) {
    return {
      modelKey: bestMatch.modelKey,
      displayModel: index.displayModelByKey.get(bestMatch.modelKey) || bestMatch.displayModel,
      matched: true,
    };
  }

  return { modelKey: NOT_SPECIFIED, displayModel: NOT_SPECIFIED, matched: false };
}

export async function loadCompanyBusinessModelIndex() {
  const rows = await CompanyStatic.find({})
    .select("name nameKey business_model")
    .lean();
  return buildCompanyBusinessModelIndex(rows);
}

/**
 * @param {Array<{ company: string, offers: number, deptCounts?: Record<string, number>, ctcBuckets?: Record<string, number> }>} companyPlacementRows
 * @param {ReturnType<typeof buildCompanyBusinessModelIndex>} index
 */
export function buildBusinessModelTables(companyPlacementRows, index) {
  /** @type {Record<string, { displayModel: string, companies: Set<string>, companyOffers: Record<string, number>, offers: number, ctcBuckets: Record<string, number>, deptCounts: Record<string, number>, matchedOffers: number }>} */
  const map = {};
  let unmatchedOffers = 0;
  let matchedOffers = 0;
  /** @type {Set<string>} */
  const unmatchedCompanySet = new Set();

  for (const row of companyPlacementRows) {
    const company = String(row.company ?? "").trim();
    const offers = Number(row.offers) || 0;
    if (!company || offers <= 0) continue;

    const { modelKey, displayModel, matched } = resolveBusinessModelForCompany(company, index);
    if (!map[modelKey]) {
      map[modelKey] = {
        displayModel,
        companies: new Set(),
        companyOffers: {},
        offers: 0,
        ctcBuckets: {},
        deptCounts: {},
        matchedOffers: 0,
      };
    }

    const bucket = map[modelKey];
    if (!bucket.displayModel && displayModel) {
      bucket.displayModel = displayModel;
    }
    bucket.companies.add(company);
    bucket.companyOffers[company] = (bucket.companyOffers[company] || 0) + offers;
    bucket.offers += offers;

    for (const [range, count] of Object.entries(row.ctcBuckets || {})) {
      const n = Number(count) || 0;
      if (n <= 0) continue;
      bucket.ctcBuckets[range] = (bucket.ctcBuckets[range] || 0) + n;
    }

    for (const [department, count] of Object.entries(row.deptCounts || {})) {
      const n = Number(count) || 0;
      if (n <= 0) continue;
      bucket.deptCounts[department] = (bucket.deptCounts[department] || 0) + n;
    }

    if (matched) {
      bucket.matchedOffers += offers;
      matchedOffers += offers;
    } else {
      unmatchedOffers += offers;
      unmatchedCompanySet.add(company);
    }
  }

  const businessModelSummary = Object.entries(map)
    .map(([modelKey, value]) => ({
      model: index.displayModelByKey.get(modelKey) || value.displayModel || modelKey,
      modelKey,
      companies: value.companies.size,
      hubCompanies: index.hubCountByModelKey.get(modelKey) || 0,
      offers: value.offers,
      ctcRange: summarizeCtcRangeForModel(value.ctcBuckets),
      ctcBreakdown: buildCtcBreakdownForModel(value.ctcBuckets, value.offers),
      companyList: Object.entries(value.companyOffers)
        .map(([company, offerCount]) => ({ company, offers: offerCount }))
        .sort((a, b) => b.offers - a.offers || a.company.localeCompare(b.company)),
    }))
    .sort((a, b) => b.offers - a.offers || a.model.localeCompare(b.model));

  /** @type {Record<string, number>} */
  const departmentTotals = {};
  for (const value of Object.values(map)) {
    for (const [department, count] of Object.entries(value.deptCounts)) {
      departmentTotals[department] = (departmentTotals[department] || 0) + count;
    }
  }

  const departments = Object.entries(departmentTotals)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([department]) => department);

  const businessModelByDepartment = {
    departments,
    rows: businessModelSummary.map(({ modelKey, model }) => {
      const value = map[modelKey];
      const byDepartment = Object.fromEntries(
        departments.map((department) => [department, value.deptCounts[department] || 0]),
      );
      const total = Object.values(value.deptCounts).reduce((sum, count) => sum + count, 0);
      return { model, byDepartment, total };
    }),
  };

  return {
    businessModelSummary,
    businessModelByDepartment,
    matchedOffers,
    unmatchedOffers,
    unmatchedCompanies: unmatchedCompanySet.size,
  };
}

/**
 * @param {object|null|undefined} stats
 */
export async function attachBusinessModelStats(stats) {
  if (!stats || typeof stats !== "object") return stats;

  const {
    businessModelSummary: _prevSummary,
    businessModelByDepartment: _prevByDept,
    businessModelMeta: _prevMeta,
    byBusinessModel: _legacyByModel,
    companyOfferTotals: _companyOfferTotals,
    companyPlacementRows: storedPlacementRows,
    ...baseStats
  } = stats;

  const topCompanies = stats.topCompanies;

  const companyPlacementRows = Array.isArray(storedPlacementRows)
    ? storedPlacementRows
    : Array.isArray(topCompanies)
      ? topCompanies.map(({ company, offers }) => ({
          company,
          offers,
          deptCounts: {},
          ctcBuckets: {},
        }))
      : [];

  const partial = !Array.isArray(storedPlacementRows) || storedPlacementRows.length === 0;

  const emptyMeta = {
    partial: true,
    matchedOfferPct: 0,
    unmatchedOffers: 0,
    unmatchedCompanies: 0,
    totalRecruitingCompanies: 0,
  };

  if (!companyPlacementRows.length) {
    return {
      ...baseStats,
      businessModelSummary: [],
      businessModelByDepartment: { departments: [], rows: [] },
      businessModelMeta: emptyMeta,
    };
  }

  const index = await loadCompanyBusinessModelIndex();
  const {
    businessModelSummary,
    businessModelByDepartment,
    matchedOffers,
    unmatchedOffers,
    unmatchedCompanies,
  } = buildBusinessModelTables(companyPlacementRows, index);

  const offerDenominator = companyPlacementRows.reduce(
    (sum, row) => sum + (Number(row.offers) || 0),
    0,
  );
  const matchedOfferPct =
    offerDenominator > 0 ? Math.round((matchedOffers / offerDenominator) * 1000) / 10 : 0;

  return {
    ...baseStats,
    businessModelSummary,
    businessModelByDepartment,
    businessModelMeta: {
      partial,
      matchedOfferPct,
      unmatchedOffers,
      unmatchedCompanies,
      totalRecruitingCompanies: companyPlacementRows.length,
    },
  };
}

export function invalidateCompanyBusinessModelIndexCache() {
  // No-op: business models are read fresh from MongoDB on each stats request.
}
