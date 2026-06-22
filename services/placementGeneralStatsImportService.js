import XLSX from "xlsx";

const DEPT_COLUMNS = [
  ["AIML", "AI/ML"],
  ["ASE", "ASE"],
  ["BT", "BT"],
  ["CH", "CH"],
  ["Civil", "Civil"],
  ["CSE", "CSE"],
  ["CS-DS", "CS-DS"],
  ["CS-CYB", "CS-CYB"],
  ["ECE", "ECE"],
  ["EEE", "EEE"],
  ["EIE", "EIE"],
  ["ETE", "ETE"],
  ["IEM", "IEM"],
  ["ISE", "ISE"],
  ["ME", "ME"],
];

const CTC_BUCKET_COLORS = {
  "< ₹10L": "#B5D4F4",
  "₹10–20L": "#378ADD",
  "₹20–30L": "#185FA5",
  "₹30–50L": "#BA7517",
  "> ₹50L": "#534AB7",
};

const MONTH_ORDER = [
  "May–Aug (PPO)",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Nov–Dec",
  "Dec",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
];

/**
 * @param {unknown} val
 * @returns {number|null}
 */
function parseCtc(val) {
  if (val == null || val === "") return null;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const s = String(val).replace(/,/g, "").trim();
  const parts = s.split(/[&/]/);
  const nums = parts
    .map((p) => {
      const n = parseFloat(p.replace(/[^\d.]/g, ""));
      return Number.isFinite(n) ? n : null;
    })
    .filter((n) => n != null);
  return nums.length ? Math.max(...nums) : null;
}

/**
 * @param {unknown} monthRaw
 * @returns {string}
 */
function normalizeMonth(monthRaw) {
  if (monthRaw == null || monthRaw === "") return "Unknown";
  const s = String(monthRaw).trim().toLowerCase();
  if (s.includes("may") && s.includes("aug")) return "May–Aug (PPO)";
  if (s.includes("nov") && s.includes("dec")) return "Nov–Dec";
  if (s === "feb" || s === "february") return "Feb";
  if (s === "march" || s === "mar") return "Mar";
  if (s === "april" || s === "apr") return "Apr";
  if (s === "jan" || s === "january") return "Jan";
  if (s === "dec" || s === "december") return "Dec";
  if (s === "nov" || s === "november") return "Nov";
  if (s === "oct" || s === "october") return "Oct";
  if (s === "sept" || s === "sep" || s === "september") return "Sept";
  if (s === "aug" || s === "august") return "Aug";
  return String(monthRaw).trim();
}

/**
 * @param {number|null} ctc
 * @returns {string}
 */
export function ctcBucket(ctc) {
  if (ctc == null) return "Unknown";
  const l = ctc / 100000;
  if (l < 10) return "< ₹10L";
  if (l < 20) return "₹10–20L";
  if (l < 30) return "₹20–30L";
  if (l < 50) return "₹30–50L";
  return "> ₹50L";
}

/**
 * @param {string} name
 * @returns {string}
 */
export function normalizeTopCompanyName(name) {
  const n = String(name || "").trim();
  if (/oracle|oralce/i.test(n)) return "Oracle / OFSS";
  if (n.startsWith("Boeing")) return "Boeing";
  if (n === "HPE") return "HPE";
  if (n.includes("Honda Motorcycle")) return "Honda M&S";
  return n;
}

/**
 * @param {string} month
 * @returns {{ month: string, chartLabel: string, variant: string }}
 */
function monthlyTimelineMeta(month) {
  if (month === "May–Aug (PPO)") {
    return { month, chartLabel: "PPO", variant: "ppo" };
  }
  if (month === "Mar" || month === "Apr") {
    return { month, chartLabel: month, variant: "late" };
  }
  if (month === "Nov–Dec") {
    return { month, chartLabel: "Nov–Dec", variant: "default" };
  }
  return { month, chartLabel: month, variant: "default" };
}

/**
 * @param {number} lakhs
 * @returns {string}
 */
function formatCtcLakhs(lakhs) {
  const rounded = Math.round(lakhs * 10) / 10;
  return Number.isInteger(rounded) ? `₹${rounded}L` : `₹${rounded.toFixed(1)}L`;
}

/** @type {Record<string, string>} */
const DEPT_DISPLAY_BY_COL = Object.fromEntries(DEPT_COLUMNS);

/**
 * @param {unknown} val
 * @returns {number|null}
 */
function parseStrengthCell(val) {
  if (val == null || val === "") return null;
  if (typeof val === "number" && Number.isFinite(val) && val > 0) return Math.round(val);
  const n = Number.parseInt(String(val).replace(/,/g, "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {unknown[]} row
 * @returns {boolean}
 */
function rowHasStrengthLabel(row) {
  if (!Array.isArray(row)) return false;
  const joined = row
    .slice(0, 5)
    .map((c) => String(c ?? "").toLowerCase())
    .join(" ");
  return /strength|students|student|batch|intake|sanctioned|enrolled|roll strength|no\. of students|nos\. of students/.test(
    joined,
  );
}

/**
 * @param {unknown[]} row
 * @param {{ col: string, idx: number }[]} deptColIndexes
 * @returns {Record<string, number>|null}
 */
function extractDepartmentStrengthFromRow(row, deptColIndexes) {
  if (!Array.isArray(row)) return null;
  /** @type {Record<string, number>} */
  const out = {};
  let hits = 0;
  for (const { col, idx } of deptColIndexes) {
    if (idx < 0) continue;
    const n = parseStrengthCell(row[idx]);
    if (n != null) {
      out[DEPT_DISPLAY_BY_COL[col] || col] = n;
      hits += 1;
    }
  }
  return hits >= 2 ? out : null;
}

/**
 * @param {unknown[][]} matrix
 * @param {number} headerRowIdx
 * @param {{ col: string, idx: number }[]} deptColIndexes
 * @returns {Record<string, number>}
 */
function parseDepartmentStrengthMap(matrix, headerRowIdx, deptColIndexes) {
  for (let i = 0; i < headerRowIdx; i += 1) {
    const row = matrix[i];
    if (!rowHasStrengthLabel(row)) continue;
    const parsed = extractDepartmentStrengthFromRow(row, deptColIndexes);
    if (parsed) return parsed;
  }

  if (headerRowIdx > 0) {
    const prev = matrix[headerRowIdx - 1];
    const joined = Array.isArray(prev)
      ? prev.map((c) => String(c ?? "").toLowerCase()).join("|")
      : "";
    if (!joined.includes("company name")) {
      const parsed = extractDepartmentStrengthFromRow(prev, deptColIndexes);
      if (parsed) return parsed;
    }
  }

  for (let i = matrix.length - 1; i > headerRowIdx; i -= 1) {
    const row = matrix[i];
    if (!Array.isArray(row)) continue;
    const first = String(row[0] ?? "").trim();
    if (!first) continue;
    if (!rowHasStrengthLabel(row)) continue;
    const parsed = extractDepartmentStrengthFromRow(row, deptColIndexes);
    if (parsed) return parsed;
  }

  return {};
}

/**
 * @param {import("xlsx").WorkBook} workbook
 * @param {{ col: string, idx: number }[]} deptColIndexes
 * @returns {Record<string, number>}
 */
function parseDepartmentStrengthFromWorkbook(workbook, deptColIndexes) {
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: true,
    });
    if (!Array.isArray(matrix) || matrix.length === 0) continue;

    let headerRowIdx = null;
    for (let i = 0; i < Math.min(matrix.length, 15); i += 1) {
      const row = matrix[i];
      if (!Array.isArray(row)) continue;
      const joined = row.map((c) => String(c ?? "").toLowerCase()).join("|");
      if (
        joined.includes("company name") &&
        joined.includes("be total") &&
        (joined.includes("ctc") || joined.includes("stipend"))
      ) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx != null) {
      const fromMain = parseDepartmentStrengthMap(matrix, headerRowIdx, deptColIndexes);
      if (Object.keys(fromMain).length > 0) return fromMain;
    }

    for (let i = 0; i < matrix.length; i += 1) {
      const row = matrix[i];
      if (!rowHasStrengthLabel(row)) continue;
      const parsed = extractDepartmentStrengthFromRow(row, deptColIndexes);
      if (parsed) return parsed;
    }

    const headers = Array.isArray(matrix[0])
      ? matrix[0].map((h) => String(h ?? "").trim().toLowerCase())
      : [];
    const deptIdx = headers.findIndex((h) => h === "department" || h === "branch" || h === "program" || h === "dept");
    const studentsIdx = headers.findIndex(
      (h) =>
        h === "students" ||
        h === "strength" ||
        h === "batch strength" ||
        h === "no. of students" ||
        h === "nos. of students" ||
        h === "count",
    );
    if (deptIdx >= 0 && studentsIdx >= 0) {
      /** @type {Record<string, number>} */
      const fromTable = {};
      for (let r = 1; r < matrix.length; r += 1) {
        const row = matrix[r];
        if (!Array.isArray(row)) continue;
        const deptRaw = String(row[deptIdx] ?? "").trim();
        const n = parseStrengthCell(row[studentsIdx]);
        if (!deptRaw || n == null) continue;
        const colMatch = DEPT_COLUMNS.find(
          ([col, display]) =>
            deptRaw.toLowerCase() === col.toLowerCase() ||
            deptRaw.toLowerCase() === display.toLowerCase(),
        );
        const department = colMatch ? colMatch[1] : deptRaw;
        fromTable[department] = n;
      }
      if (Object.keys(fromTable).length >= 2) return fromTable;
    }
  }

  return {};
}

/**
 * @param {number} offers
 * @param {number|null|undefined} students
 * @returns {number|null}
 */
function placementPctForDepartment(offers, students) {
  if (students == null || students <= 0) return null;
  return Math.min(100, Math.round((offers / students) * 1000) / 10);
}

/**
 * Parse placement statistics workbook buffer into dashboard payload.
 * @param {Buffer} buffer
 * @param {number} year
 * @returns {{ success: true, stats: object } | { success: false, error: string, details?: string[] }}
 */
export function buildGeneralStatsFromXlsxBuffer(buffer, year) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  } catch {
    return {
      success: false,
      error: "Could not read the Excel file. Ensure it is a valid .xlsx workbook.",
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { success: false, error: "The workbook has no sheets." };
  }

  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
  });

  if (!matrix.length) {
    return { success: false, error: "The spreadsheet is empty." };
  }

  /** @type {number|null} */
  let headerRowIdx = null;
  for (let i = 0; i < Math.min(matrix.length, 10); i += 1) {
    const row = matrix[i];
    if (!Array.isArray(row)) continue;
    const joined = row.map((c) => String(c ?? "").toLowerCase()).join("|");
    if (
      joined.includes("company name") &&
      joined.includes("be total") &&
      (joined.includes("ctc") || joined.includes("stipend"))
    ) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx == null) {
    return {
      success: false,
      error:
        "Could not find the expected header row (Company Name, Month, Stipend, CTC, department columns, BE Total).",
    };
  }

  const headers = matrix[headerRowIdx].map((h) => String(h ?? "").trim());
  const colIndex = (name) => {
    const lower = name.toLowerCase();
    const idx = headers.findIndex((h) => h.toLowerCase() === lower);
    return idx >= 0 ? idx : -1;
  };

  const companyIdx = colIndex("Company Name");
  const monthIdx = colIndex("Month");
  const stipendIdx = colIndex("Stipend");
  const ctcIdx = colIndex("CTC");
  const beTotalIdx = colIndex("BE Total");

  const missing = [];
  if (companyIdx < 0) missing.push("Company Name");
  if (monthIdx < 0) missing.push("Month");
  if (stipendIdx < 0) missing.push("Stipend");
  if (ctcIdx < 0) missing.push("CTC");
  if (beTotalIdx < 0) missing.push("BE Total");

  const deptColIndexes = DEPT_COLUMNS.map(([col]) => ({
    col,
    idx: colIndex(col),
  }));

  if (missing.length) {
    return {
      success: false,
      error: `Missing required columns: ${missing.join(", ")}`,
    };
  }

  /** @type {Array<Record<string, unknown>>} */
  const rows = [];
  for (let r = headerRowIdx + 1; r < matrix.length; r += 1) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    const companyName = String(row[companyIdx] ?? "").trim();
    if (!companyName) continue;

    const beTotal = Number.parseInt(String(row[beTotalIdx] ?? 0), 10) || 0;
    if (beTotal <= 0) continue;

    const record = {
      companyName,
      month: normalizeMonth(row[monthIdx]),
      isPpo: String(row[stipendIdx] ?? "").trim().toUpperCase() === "PPO",
      ctc: parseCtc(row[ctcIdx]),
      beTotal,
      deptCounts: {},
    };

    for (const { col, idx } of deptColIndexes) {
      if (idx < 0) continue;
      const cnt = Number.parseInt(String(row[idx] ?? 0), 10) || 0;
      if (cnt > 0) record.deptCounts[col] = cnt;
    }

    rows.push(record);
  }

  if (!rows.length) {
    return {
      success: false,
      error: "No placement rows with offers (BE Total > 0) were found in the spreadsheet.",
    };
  }

  /** @type {Array<{ department: string, ctc: number|null, isPpo: boolean, month: string, companyName: string }>} */
  const offers = [];
  for (const row of rows) {
    for (const [col, displayName] of DEPT_COLUMNS) {
      const cnt = row.deptCounts[col] || 0;
      for (let i = 0; i < cnt; i += 1) {
        offers.push({
          department: displayName,
          ctc: row.ctc,
          isPpo: row.isPpo,
          month: row.month,
          companyName: row.companyName,
        });
      }
    }
  }

  const totalOffers = offers.length;
  const companiesRecruited = new Set(rows.map((r) => r.companyName)).size;

  const ctcOffers = offers.filter((o) => o.ctc != null);
  const avgCtcL = ctcOffers.reduce((s, o) => s + o.ctc, 0) / ctcOffers.length / 100000;
  const sortedCtcs = [...ctcOffers].map((o) => o.ctc).sort((a, b) => a - b);
  const mid = Math.floor(sortedCtcs.length / 2);
  const medianCtcL =
    sortedCtcs.length % 2 === 0
      ? (sortedCtcs[mid - 1] + sortedCtcs[mid]) / 2 / 100000
      : sortedCtcs[mid] / 100000;

  const maxCtc = Math.max(...ctcOffers.map((o) => o.ctc));
  const maxCompanies = [
    ...new Set(
      offers.filter((o) => o.ctc === maxCtc).map((o) => o.companyName.trim())
    ),
  ];

  const ppoOffers = offers.filter((o) => o.isPpo).length;
  const campusPlacements = totalOffers - ppoOffers;
  const offersAbove30L = offers.filter((o) => o.ctc != null && o.ctc > 3000000).length;

  const pct = (n) => `${(Math.round((n / totalOffers) * 1000) / 10).toFixed(1)}%`;

  /** @type {Record<string, number>} */
  const deptOffersMap = {};
  for (const o of offers) {
    deptOffersMap[o.department] = (deptOffersMap[o.department] || 0) + 1;
  }
  const departmentStrength = parseDepartmentStrengthFromWorkbook(workbook, deptColIndexes);
  const byDepartment = Object.entries(deptOffersMap)
    .map(([department, count]) => {
      const students = departmentStrength[department] ?? null;
      return {
        department,
        offers: count,
        students,
        placementPct: placementPctForDepartment(count, students),
      };
    })
    .sort((a, b) => {
      const aPct = a.placementPct ?? -1;
      const bPct = b.placementPct ?? -1;
      if (aPct !== bPct) return bPct - aPct;
      return b.offers - a.offers;
    });

  /** @type {Record<string, number>} */
  const bucketCounts = {};
  for (const o of offers) {
    if (o.ctc == null) continue;
    const b = ctcBucket(o.ctc);
    bucketCounts[b] = (bucketCounts[b] || 0) + 1;
  }
  const ctcDistribution = Object.keys(CTC_BUCKET_COLORS).map((range) => ({
    range,
    offers: bucketCounts[range] || 0,
    color: CTC_BUCKET_COLORS[range],
  }));

  const ctcRangeKeys = Object.keys(CTC_BUCKET_COLORS);
  /** @type {Record<string, Record<string, number>>} */
  const deptCtcBucketMap = {};
  for (const o of offers) {
    if (o.ctc == null) continue;
    const range = ctcBucket(o.ctc);
    if (!deptCtcBucketMap[o.department]) {
      deptCtcBucketMap[o.department] = Object.fromEntries(ctcRangeKeys.map((k) => [k, 0]));
    }
    deptCtcBucketMap[o.department][range] += 1;
  }
  const ctcByDepartment = Object.entries(deptCtcBucketMap)
    .map(([department, buckets]) => {
      const total = ctcRangeKeys.reduce((sum, key) => sum + (buckets[key] || 0), 0);
      return { department, ...buckets, total };
    })
    .sort((a, b) => b.total - a.total);

  /** @type {Record<string, { offers: number, deptCounts: Record<string, number>, ctcBuckets: Record<string, number> }>} */
  const companyPlacementAgg = {};
  for (const row of rows) {
    const company = normalizeTopCompanyName(row.companyName);
    if (!companyPlacementAgg[company]) {
      companyPlacementAgg[company] = { offers: 0, deptCounts: {}, ctcBuckets: {} };
    }
    companyPlacementAgg[company].offers += row.beTotal;
    const bucket = row.ctc != null ? ctcBucket(row.ctc) : "Unknown";
    companyPlacementAgg[company].ctcBuckets[bucket] =
      (companyPlacementAgg[company].ctcBuckets[bucket] || 0) + row.beTotal;
    for (const [col, displayName] of DEPT_COLUMNS) {
      const cnt = row.deptCounts[col] || 0;
      if (cnt > 0) {
        companyPlacementAgg[company].deptCounts[displayName] =
          (companyPlacementAgg[company].deptCounts[displayName] || 0) + cnt;
      }
    }
  }
  const companyPlacementRows = Object.entries(companyPlacementAgg)
    .sort((a, b) => b[1].offers - a[1].offers || a[0].localeCompare(b[0]))
    .map(([company, data]) => ({
      company,
      offers: data.offers,
      deptCounts: data.deptCounts,
      ctcBuckets: data.ctcBuckets,
    }));

  /** @type {Record<string, number>} */
  const companyTotals = {};
  for (const row of companyPlacementRows) {
    companyTotals[row.company] = row.offers;
  }
  const companyOfferTotals = Object.entries(companyTotals)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([company, offers]) => ({ company, offers }));
  const topCompanies = companyOfferTotals.slice(0, 12);

  /** @type {Record<string, number>} */
  const monthCounts = {};
  for (const o of offers) {
    monthCounts[o.month] = (monthCounts[o.month] || 0) + 1;
  }
  /** @type {Record<string, Set<string>>} */
  const monthCompanySets = {};
  for (const row of rows) {
    if (!monthCompanySets[row.month]) monthCompanySets[row.month] = new Set();
    monthCompanySets[row.month].add(row.companyName);
  }
  const monthlyTimeline = MONTH_ORDER.filter((m) => monthCounts[m] > 0).map((m) => ({
    ...monthlyTimelineMeta(m),
    offers: monthCounts[m],
    companies: monthCompanySets[m]?.size ?? 0,
  }));

  /** @type {Record<string, Record<string, { offers: number, companies: Set<string> }>>} */
  const monthDeptAgg = {};
  for (const row of rows) {
    const month = row.month;
    if (!monthDeptAgg[month]) monthDeptAgg[month] = {};
    for (const [col, displayName] of DEPT_COLUMNS) {
      const cnt = row.deptCounts[col] || 0;
      if (cnt <= 0) continue;
      if (!monthDeptAgg[month][displayName]) {
        monthDeptAgg[month][displayName] = { offers: 0, companies: new Set() };
      }
      monthDeptAgg[month][displayName].offers += cnt;
      monthDeptAgg[month][displayName].companies.add(row.companyName);
    }
  }
  const monthlyByDepartment = MONTH_ORDER.filter((m) => monthDeptAgg[m]).map((m) => {
    const departments = Object.entries(monthDeptAgg[m])
      .map(([department, { offers, companies }]) => ({
        department,
        offers,
        companies: companies.size,
      }))
      .sort((a, b) => b.offers - a.offers || a.department.localeCompare(b.department));
    return {
      ...monthlyTimelineMeta(m),
      month: m,
      departments,
      totalOffers: monthCounts[m] ?? 0,
      totalCompanies: monthCompanySets[m]?.size ?? 0,
    };
  });

  /** @type {Record<string, { sum: number, count: number }>} */
  const deptCtcMap = {};
  for (const o of offers) {
    if (o.ctc == null) continue;
    if (!deptCtcMap[o.department]) deptCtcMap[o.department] = { sum: 0, count: 0 };
    deptCtcMap[o.department].sum += o.ctc;
    deptCtcMap[o.department].count += 1;
  }
  const departmentAvgCtc = Object.entries(deptCtcMap)
    .map(([department, { sum, count }]) => ({
      department,
      avgCtc: Math.round((sum / count / 100000) * 10) / 10,
      offers: deptOffersMap[department] || count,
    }))
    .sort((a, b) => b.avgCtc - a.avgCtc);

  const stats = {
    year,
    totalOffers,
    kpis: {
      totalOffers,
      companiesRecruited,
      highestCtc: {
        value: formatCtcLakhs(maxCtc / 100000),
        note: maxCompanies.slice(0, 3).join(" & "),
      },
      averageCtc: {
        value: formatCtcLakhs(avgCtcL),
        note: `Median ${formatCtcLakhs(medianCtcL)}`,
      },
      ppoOffers: {
        value: ppoOffers,
        note: `${pct(ppoOffers)} of total offers`,
      },
      campusPlacements: {
        value: campusPlacements,
        note: `${pct(campusPlacements)} of total offers`,
      },
      offersAbove30L: {
        value: offersAbove30L,
        note: `${pct(offersAbove30L)} of total offers`,
      },
    },
    byDepartment,
    ctcDistribution,
    ctcByDepartment,
    companyPlacementRows,
    companyOfferTotals,
    topCompanies,
    monthlyTimeline,
    monthlyByDepartment,
    departmentAvgCtc,
  };

  return { success: true, stats };
}

/**
 * @param {object} stats
 * @param {string} uploadedBy
 * @param {string} sourceFileName
 */
export function statsDocumentFromPayload(stats, uploadedBy = "", sourceFileName = "") {
  return {
    year: stats.year,
    totalOffers: stats.totalOffers,
    kpis: stats.kpis,
    byDepartment: stats.byDepartment,
    ctcDistribution: stats.ctcDistribution,
    ctcByDepartment: stats.ctcByDepartment,
    companyPlacementRows: stats.companyPlacementRows,
    companyOfferTotals: stats.companyOfferTotals,
    topCompanies: stats.topCompanies,
    monthlyTimeline: stats.monthlyTimeline,
    monthlyByDepartment: stats.monthlyByDepartment,
    departmentAvgCtc: stats.departmentAvgCtc,
    uploadedBy,
    sourceFileName,
  };
}

/**
 * @param {import("mongoose").Document|null|undefined} doc
 */
export function serializeGeneralStatsDoc(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    year: plain.year,
    totalOffers: plain.totalOffers,
    kpis: plain.kpis,
    byDepartment: plain.byDepartment,
    ctcDistribution: plain.ctcDistribution,
    ctcByDepartment: Array.isArray(plain.ctcByDepartment) ? plain.ctcByDepartment : [],
    companyPlacementRows: Array.isArray(plain.companyPlacementRows) ? plain.companyPlacementRows : [],
    companyOfferTotals: Array.isArray(plain.companyOfferTotals) ? plain.companyOfferTotals : [],
    topCompanies: plain.topCompanies,
    monthlyTimeline: plain.monthlyTimeline,
    monthlyByDepartment: Array.isArray(plain.monthlyByDepartment) ? plain.monthlyByDepartment : [],
    departmentAvgCtc: plain.departmentAvgCtc,
    lastUpdatedAt: plain.updatedAt || plain.createdAt || null,
    uploadedBy: plain.uploadedBy || "",
    sourceFileName: plain.sourceFileName || "",
  };
}
