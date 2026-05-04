import mongoose from "mongoose";
import XLSX from "xlsx";

/** Maximum non-blank data rows (excluding header) per upload. */
export const MAX_STUDENT_BATCH_DATA_ROWS = 2000;

/** Chunk size for insertMany inside a single transaction. */
export const STUDENT_BATCH_INSERT_CHUNK = 500;

/**
 * Human-readable Excel headers → Student schema fields.
 * First column in each group wins when multiple headers match (document for admins).
 */
export const STUDENT_BATCH_HEADER_ALIASES = {
  name: ["name", "student name", "full name", "studentname"],
  email: ["email", "email id", "e-mail", "email address", "mail id", "mail", "e mail"],
  usn: ["usn", "registration number", "reg no", "reg. no", "reg number", "university seat number"],
  phoneNumber: ["phone", "phone number", "mobile", "contact", "contact number", "mobile number", "tel"],
  branch: ["branch", "department", "dept", "branch name"],
};

/** Admin-facing documentation (same order as typical template). */
export const STUDENT_BATCH_COLUMN_GUIDE = [
  { labels: ["Name"], field: "name", required: true },
  { labels: ["Email", "Email ID"], field: "email", required: true },
  { labels: ["USN", "Registration number"], field: "usn", required: true },
  { labels: ["Phone", "Mobile"], field: "phoneNumber", required: false },
  { labels: ["Branch", "Department"], field: "branch", required: false },
];

export function normalizeHeaderLabel(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildAliasToFieldMap() {
  const map = new Map();
  for (const [field, aliases] of Object.entries(STUDENT_BATCH_HEADER_ALIASES)) {
    for (const a of aliases) {
      map.set(normalizeHeaderLabel(a), field);
    }
    map.set(normalizeHeaderLabel(field), field);
  }
  return map;
}

const ALIAS_TO_FIELD = buildAliasToFieldMap();

/**
 * Map header row (array of cell values) to field → column index.
 * @returns {Record<string, number>} indices for name, email, usn; phoneNumber/branch optional (-1 if absent)
 */
export function resolveStudentBatchColumnMap(headerRow) {
  if (!Array.isArray(headerRow) || headerRow.length === 0) {
    throw new Error("MISSING_HEADER_ROW");
  }
  const fieldToIndex = {};
  for (let c = 0; c < headerRow.length; c++) {
    const label = normalizeHeaderLabel(headerRow[c]);
    if (!label) continue;
    const field = ALIAS_TO_FIELD.get(label);
    if (!field) continue;
    if (fieldToIndex[field] === undefined) {
      fieldToIndex[field] = c;
    }
  }
  for (const req of ["name", "email", "usn"]) {
    if (fieldToIndex[req] === undefined) {
      const err = new Error("MISSING_REQUIRED_COLUMNS");
      err.missingField = req;
      throw err;
    }
  }
  return {
    name: fieldToIndex.name,
    email: fieldToIndex.email,
    usn: fieldToIndex.usn,
    phoneNumber: fieldToIndex.phoneNumber ?? -1,
    branch: fieldToIndex.branch ?? -1,
  };
}

export function isDataRowBlank(row, colMap) {
  const idxs = [colMap.name, colMap.email, colMap.usn];
  if (colMap.phoneNumber >= 0) idxs.push(colMap.phoneNumber);
  if (colMap.branch >= 0) idxs.push(colMap.branch);
  for (const i of idxs) {
    const v = row[i];
    if (v != null && String(v).trim() !== "") return false;
  }
  return true;
}

function cellAt(row, idx) {
  if (idx < 0 || !row) return "";
  const v = row[idx];
  if (v == null) return "";
  return String(v).trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateStudentBatchRow({ name, email, usn }) {
  const reasons = [];
  if (!name) reasons.push("Name is required");
  if (!email) reasons.push("Email is required");
  else if (!EMAIL_RE.test(email)) reasons.push("Invalid email format");
  if (!usn) reasons.push("USN is required");
  return reasons;
}

function transactionUnsupportedError(err) {
  const msg = String(err?.message || "");
  const code = err?.code;
  return (
    code === 20 ||
    code === 303 ||
    msg.includes("Transaction numbers are only allowed") ||
    (msg.toLowerCase().includes("transaction") && msg.toLowerCase().includes("replica set"))
  );
}

/**
 * Parse .xlsx buffer to a 2D array (first row = headers).
 */
export function parseStudentBatchXlsxToMatrix(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error("INVALID_BUFFER");
  }
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("EMPTY_WORKBOOK");
  }
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  if (!Array.isArray(matrix) || matrix.length < 2) {
    throw new Error("NO_DATA_ROWS");
  }
  return matrix;
}

function countNonBlankDataRows(matrix, colMap) {
  let n = 0;
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    if (!isDataRowBlank(row, colMap)) n += 1;
  }
  return n;
}

/**
 * Full pipeline: validate → dedupe (file + DB) → transactional bulk insert.
 * @param {Buffer} buffer
 * @param {import('mongoose').Model} StudentModel
 */
export async function importStudentsFromXlsxBuffer(buffer, StudentModel) {
  let matrix;
  try {
    matrix = parseStudentBatchXlsxToMatrix(buffer);
  } catch (parseErr) {
    const code = parseErr?.message || "PARSE_ERROR";
    const isKnown =
      code === "NO_DATA_ROWS" || code === "EMPTY_WORKBOOK" || code === "INVALID_BUFFER";
    return {
      success: false,
      code: isKnown ? code : "PARSE_ERROR",
      message: isKnown
        ? code === "NO_DATA_ROWS"
          ? "Add at least one data row below the header row."
          : "The spreadsheet could not be read."
        : "Could not read the Excel file. Ensure it is a valid .xlsx workbook.",
      inserted: 0,
      skippedCount: 0,
      failedCount: 0,
      failed: [],
      skipped: [],
      columnGuide: STUDENT_BATCH_COLUMN_GUIDE,
    };
  }
  const headerRow = matrix[0];
  let colMap;
  try {
    colMap = resolveStudentBatchColumnMap(headerRow);
  } catch (e) {
    if (e.message === "MISSING_REQUIRED_COLUMNS") {
      return {
        success: false,
        code: "MISSING_COLUMNS",
        message: `The sheet must include a recognized header for: ${e.missingField}. See column guide for accepted labels.`,
        inserted: 0,
        skippedCount: 0,
        failedCount: 0,
        failed: [],
        skipped: [],
        columnGuide: STUDENT_BATCH_COLUMN_GUIDE,
      };
    }
    if (e.message === "MISSING_HEADER_ROW") {
      return {
        success: false,
        code: "INVALID_SHEET",
        message: "The spreadsheet has no header row.",
        inserted: 0,
        skippedCount: 0,
        failedCount: 0,
        failed: [],
        skipped: [],
        columnGuide: STUDENT_BATCH_COLUMN_GUIDE,
      };
    }
    throw e;
  }

  const nonBlankCount = countNonBlankDataRows(matrix, colMap);
  if (nonBlankCount === 0) {
    return {
      success: false,
      code: "NO_DATA",
      message: "No student rows found below the header.",
      inserted: 0,
      skippedCount: 0,
      failedCount: 0,
      failed: [],
      skipped: [],
      columnGuide: STUDENT_BATCH_COLUMN_GUIDE,
    };
  }
  if (nonBlankCount > MAX_STUDENT_BATCH_DATA_ROWS) {
    return {
      success: false,
      code: "ROW_LIMIT",
      message: `This file has ${nonBlankCount} non-empty data rows. The limit is ${MAX_STUDENT_BATCH_DATA_ROWS} rows per upload.`,
      inserted: 0,
      skippedCount: 0,
      failedCount: 0,
      failed: [],
      skipped: [],
      columnGuide: STUDENT_BATCH_COLUMN_GUIDE,
    };
  }

  const failed = [];
  const skipped = [];
  /** @type {{ excelRow: number, doc: { name: string, email: string, usn: string, phoneNumber: string, branch: string } }[]} */
  const fileWinners = [];

  const seenEmail = new Map();
  const seenUsn = new Map();

  for (let r = 1; r < matrix.length; r++) {
    const row = Array.isArray(matrix[r]) ? matrix[r] : [];
    const excelRow = r + 1;
    if (isDataRowBlank(row, colMap)) continue;

    const name = cellAt(row, colMap.name);
    const emailRaw = cellAt(row, colMap.email).toLowerCase();
    const usn = cellAt(row, colMap.usn).toUpperCase();
    const phoneNumber =
      colMap.phoneNumber >= 0 ? cellAt(row, colMap.phoneNumber) : "";
    const branch = colMap.branch >= 0 ? cellAt(row, colMap.branch) : "";

    const reasons = validateStudentBatchRow({ name, email: emailRaw, usn });
    if (reasons.length) {
      failed.push({ excelRow, reason: reasons.join("; ") });
      continue;
    }

    if (seenUsn.has(usn)) {
      skipped.push({
        excelRow,
        reason: "Duplicate USN or email in file (first row wins).",
      });
      continue;
    }
    if (seenEmail.has(emailRaw)) {
      skipped.push({
        excelRow,
        reason: "Duplicate USN or email in file (first row wins).",
      });
      continue;
    }

    seenUsn.set(usn, excelRow);
    seenEmail.set(emailRaw, excelRow);

    fileWinners.push({
      excelRow,
      doc: {
        name,
        email: emailRaw,
        usn,
        phoneNumber,
        branch,
      },
    });
  }

  if (failed.length > 0) {
    return {
      success: false,
      code: "VALIDATION_FAILED",
      message:
        "Fix the failed rows and re-upload. No rows were written to the database.",
      inserted: 0,
      skippedCount: 0,
      failedCount: failed.length,
      failed,
      skipped: [],
      columnGuide: STUDENT_BATCH_COLUMN_GUIDE,
    };
  }

  const emails = [...new Set(fileWinners.map((w) => w.doc.email))];
  const usns = [...new Set(fileWinners.map((w) => w.doc.usn))];
  const existing = await StudentModel.find({
    $or: [{ email: { $in: emails } }, { usn: { $in: usns } }],
  })
    .select("email usn")
    .lean();

  const existingEmails = new Set(existing.map((d) => String(d.email || "").toLowerCase()));
  const existingUsns = new Set(existing.map((d) => String(d.usn || "").toUpperCase()));

  const toInsert = [];
  const insertedRows = [];

  for (const w of fileWinners) {
    const { doc, excelRow } = w;
    if (existingEmails.has(doc.email) || existingUsns.has(doc.usn)) {
      skipped.push({
        excelRow,
        reason: "Email or USN already exists in the database.",
      });
      continue;
    }
    toInsert.push(doc);
    insertedRows.push(excelRow);
  }

  if (toInsert.length === 0) {
    return {
      success: true,
      code: "OK",
      message: "No new students to insert (all rows were skipped).",
      inserted: 0,
      skippedCount: skipped.length,
      failedCount: 0,
      failed: [],
      skipped,
      insertedExcelRows: [],
      columnGuide: STUDENT_BATCH_COLUMN_GUIDE,
    };
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (let i = 0; i < toInsert.length; i += STUDENT_BATCH_INSERT_CHUNK) {
        const chunk = toInsert.slice(i, i + STUDENT_BATCH_INSERT_CHUNK);
        await StudentModel.insertMany(chunk, { session, ordered: true });
      }
    });
  } catch (err) {
    if (transactionUnsupportedError(err)) {
      return {
        success: false,
        code: "TRANSACTIONS_NOT_SUPPORTED",
        message:
          "MongoDB must run as a replica set (or Atlas) so batch imports can be all-or-nothing. Standalone servers do not support multi-document transactions.",
        inserted: 0,
        skippedCount: skipped.length,
        failedCount: 0,
        failed: [],
        skipped,
        columnGuide: STUDENT_BATCH_COLUMN_GUIDE,
      };
    }
    throw err;
  } finally {
    await session.endSession();
  }

  console.info(
    `[student-batch-import] inserted=${toInsert.length} skipped=${skipped.length} failed=0`
  );

  return {
    success: true,
    code: "OK",
    message: `Successfully inserted ${toInsert.length} student(s).`,
    inserted: toInsert.length,
    skippedCount: skipped.length,
    failedCount: 0,
    failed: [],
    skipped,
    insertedExcelRows: insertedRows,
    columnGuide: STUDENT_BATCH_COLUMN_GUIDE,
  };
}
