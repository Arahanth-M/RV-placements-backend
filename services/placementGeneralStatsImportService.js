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
function ctcBucket(ctc) {
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
function normalizeTopCompanyName(name) {
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
  const byDepartment = Object.entries(deptOffersMap)
    .map(([department, count]) => ({ department, offers: count }))
    .sort((a, b) => b.offers - a.offers);

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

  /** @type {Record<string, number>} */
  const companyTotals = {};
  for (const row of rows) {
    const display = normalizeTopCompanyName(row.companyName);
    companyTotals[display] = (companyTotals[display] || 0) + row.beTotal;
  }
  const topCompanies = Object.entries(companyTotals)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([company, count]) => ({ company, offers: count }));

  /** @type {Record<string, number>} */
  const monthCounts = {};
  for (const o of offers) {
    monthCounts[o.month] = (monthCounts[o.month] || 0) + 1;
  }
  const monthlyTimeline = MONTH_ORDER.filter((m) => monthCounts[m] > 0).map((m) => ({
    ...monthlyTimelineMeta(m),
    offers: monthCounts[m],
  }));

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
    topCompanies,
    monthlyTimeline,
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
    topCompanies: stats.topCompanies,
    monthlyTimeline: stats.monthlyTimeline,
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
    topCompanies: plain.topCompanies,
    monthlyTimeline: plain.monthlyTimeline,
    departmentAvgCtc: plain.departmentAvgCtc,
    lastUpdatedAt: plain.updatedAt || plain.createdAt || null,
    uploadedBy: plain.uploadedBy || "",
    sourceFileName: plain.sourceFileName || "",
  };
}
