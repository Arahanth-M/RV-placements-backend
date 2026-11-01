import mongoose from "mongoose";
import XLSX from "xlsx";
import CompanyStatic from "../models/CompanyStatic.js";
import CompanyPlatformContent from "../models/CompanyPlatformContent.js";
import { invalidateCompanyDetailCache } from "./companyDetailCache.js";
import { normalizeSolutionText } from "../utils/normalizeSolutionText.js";
import {
  normalizePrepRoleKey,
  prepRoleCatalogMissing,
} from "../utils/prepRole.js";

export const PLATFORM_PREP_CSV_COLUMNS = Object.freeze([
  "role",
  "kind",
  "question",
  "answer",
  "intuition",
  "solutions_cpp",
  "solutions_java",
  "solutions_python",
]);

export const PLATFORM_PREP_CSV_MAX_ROWS = 500;

const KINDS = new Set(["coding", "non_coding", "sql"]);

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cell(row, ...keys) {
  for (const key of keys) {
    if (row?.[key] != null && String(row[key]).trim() !== "") {
      return String(row[key]);
    }
    const lower = key.toLowerCase();
    for (const [actual, value] of Object.entries(row || {})) {
      if (String(actual).trim().toLowerCase() === lower && String(value ?? "").trim() !== "") {
        return String(value);
      }
    }
  }
  return "";
}

function normalizeKind(raw) {
  const value = compact(raw).toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "noncoding" || value === "non_coding" || value === "theory" || value === "hr") {
    return "non_coding";
  }
  if (value === "coding" || value === "dsa" || value === "code") return "coding";
  if (value === "sql") return "sql";
  return "";
}

/**
 * Validate one CSV row into a staging question item.
 * Coding rows require intuition + cpp/java/python solutions.
 * @param {Record<string, unknown>} row
 * @param {number} rowNumber
 */
export function parsePlatformPrepCsvRow(row, rowNumber) {
  const roleRaw = cell(row, "role", "prepRole", "prep_role");
  const kind = normalizeKind(cell(row, "kind", "type", "form"));
  const question = String(cell(row, "question")).trim();
  const answer = normalizeSolutionText(cell(row, "answer", "explanation"));
  const intuition = normalizeSolutionText(cell(row, "intuition"));
  const solutions = {
    cpp: normalizeSolutionText(cell(row, "solutions_cpp", "solution_cpp", "cpp")),
    java: normalizeSolutionText(cell(row, "solutions_java", "solution_java", "java")),
    python: normalizeSolutionText(cell(row, "solutions_python", "solution_python", "python")),
  };

  if (!roleRaw) {
    throw new Error(`Row ${rowNumber}: role is required.`);
  }
  if (!KINDS.has(kind)) {
    throw new Error(`Row ${rowNumber}: kind must be coding, non_coding, or sql.`);
  }
  if (!question) {
    throw new Error(`Row ${rowNumber}: question is required.`);
  }
  if (!answer) {
    throw new Error(`Row ${rowNumber}: answer is required.`);
  }

  if (kind === "coding") {
    if (!intuition) {
      throw new Error(`Row ${rowNumber}: intuition is required for coding questions.`);
    }
    if (!solutions.cpp) {
      throw new Error(`Row ${rowNumber}: solutions_cpp is required for coding questions.`);
    }
    if (!solutions.java) {
      throw new Error(`Row ${rowNumber}: solutions_java is required for coding questions.`);
    }
    if (!solutions.python) {
      throw new Error(`Row ${rowNumber}: solutions_python is required for coding questions.`);
    }
  }

  const { key: prepRoleKey, label: prepRoleLabel } = normalizePrepRoleKey(roleRaw);
  const item = {
    prepRoleKey,
    prepRoleLabel,
    kind,
    question,
    answer,
    intuition: kind === "coding" ? intuition : intuition || "",
    status: "approved",
  };
  if (kind === "coding") {
    item.solutions = solutions;
  }
  return item;
}

/**
 * RFC4180-ish CSV parser (supports quoted multiline cells and "" escapes).
 * Prefer this over XLSX for .csv uploads — more predictable in production.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsvTextToMatrix(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (ch === "\r") {
      continue;
    }
    cell += ch;
  }

  if (inQuotes) {
    const err = new Error("The CSV has an unclosed quoted field. Re-export as UTF-8 CSV and try again.");
    err.status = 400;
    throw err;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((value) => String(value ?? "").trim() !== ""));
}

function matrixToObjectRows(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 2) return [];
  const headers = matrix[0].map((header) => String(header ?? "").trim());
  if (!headers.some(Boolean)) {
    const err = new Error("The CSV is missing a header row.");
    err.status = 400;
    throw err;
  }
  const rows = [];
  for (let r = 1; r < matrix.length; r += 1) {
    const cells = matrix[r] || [];
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = cells[c] == null ? "" : String(cells[c]);
    }
    rows.push(obj);
  }
  return rows;
}

function readCsvRowsFromBuffer(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer ?? "");
  // Fast path for plain CSVs (our template + admin exports).
  if (text.includes(",") || text.includes("\n") || text.includes("\r")) {
    try {
      return matrixToObjectRows(parseCsvTextToMatrix(text));
    } catch (error) {
      if (Number(error?.status) === 400) throw error;
      // Fall through to XLSX for odd encodings / Excel-saved files.
    }
  }

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", raw: false, codepage: 65001 });
    const sheetName = workbook?.SheetNames?.[0];
    const firstSheet = sheetName ? workbook.Sheets?.[sheetName] : null;
    return firstSheet ? XLSX.utils.sheet_to_json(firstSheet, { defval: "" }) : [];
  } catch (error) {
    const err = new Error(
      `Could not parse the CSV (${error?.message || "invalid file"}). Save as UTF-8 CSV and retry.`
    );
    err.status = 400;
    throw err;
  }
}

/**
 * @param {Buffer} buffer
 */
export function parsePlatformPrepCsvBuffer(buffer) {
  if (!buffer?.length) {
    const err = new Error('Upload a CSV using the form field "file".');
    err.status = 400;
    throw err;
  }

  let rows;
  try {
    rows = readCsvRowsFromBuffer(buffer);
  } catch (error) {
    if (Number(error?.status)) throw error;
    const err = new Error(error?.message || "Could not parse the CSV.");
    err.status = 400;
    throw err;
  }

  if (!rows.length) {
    const err = new Error("The CSV has no data rows.");
    err.status = 400;
    throw err;
  }
  if (rows.length > PLATFORM_PREP_CSV_MAX_ROWS) {
    const err = new Error(`Import at most ${PLATFORM_PREP_CSV_MAX_ROWS} questions per CSV.`);
    err.status = 400;
    throw err;
  }

  const items = [];
  const errors = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    try {
      items.push({ ...parsePlatformPrepCsvRow(row, rowNumber), rowNumber });
    } catch (error) {
      errors.push({
        row: rowNumber,
        error: error?.message || "Invalid row.",
      });
    }
  });

  return {
    totalRows: rows.length,
    validRows: items.length,
    failed: errors.length,
    items,
    errors: errors.slice(0, 200),
    columns: PLATFORM_PREP_CSV_COLUMNS,
  };
}

function asObjectId(value) {
  try {
    return new mongoose.Types.ObjectId(String(value));
  } catch {
    return null;
  }
}

function reviewerIdentity(reviewer) {
  const name = compact(reviewer?.name);
  const email = compact(reviewer?.email).toLowerCase();
  if (!name && !email) return null;
  return { name, email };
}

/**
 * Re-validate staging items from the admin review UI before DB write.
 * @param {unknown[]} rawItems
 */
export function normalizeFinalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    const err = new Error("Select at least one question to finalize.");
    err.status = 400;
    throw err;
  }
  if (rawItems.length > PLATFORM_PREP_CSV_MAX_ROWS) {
    const err = new Error(`Finalize at most ${PLATFORM_PREP_CSV_MAX_ROWS} questions at once.`);
    err.status = 400;
    throw err;
  }

  return rawItems.map((raw, index) => {
    const rowNumber = index + 1;
    const kind = normalizeKind(raw?.kind);
    const question = String(raw?.question ?? "").trim();
    const answer = normalizeSolutionText(raw?.answer);
    const intuition = normalizeSolutionText(raw?.intuition);
    const solutionsRaw = raw?.solutions && typeof raw.solutions === "object" ? raw.solutions : {};
    const solutions = {
      cpp: normalizeSolutionText(solutionsRaw.cpp ?? raw?.solutions_cpp),
      java: normalizeSolutionText(solutionsRaw.java ?? raw?.solutions_java),
      python: normalizeSolutionText(solutionsRaw.python ?? raw?.solutions_python),
    };

    if (!KINDS.has(kind)) {
      throw Object.assign(new Error(`Item ${rowNumber}: kind must be coding, non_coding, or sql.`), {
        status: 400,
      });
    }
    if (!question) {
      throw Object.assign(new Error(`Item ${rowNumber}: question is required.`), { status: 400 });
    }
    if (!answer) {
      throw Object.assign(new Error(`Item ${rowNumber}: answer is required.`), { status: 400 });
    }
    if (kind === "coding") {
      if (!intuition) {
        throw Object.assign(new Error(`Item ${rowNumber}: intuition is required for coding questions.`), {
          status: 400,
        });
      }
      if (!solutions.cpp || !solutions.java || !solutions.python) {
        throw Object.assign(
          new Error(
            `Item ${rowNumber}: solutions_cpp, solutions_java, and solutions_python are required for coding questions.`
          ),
          { status: 400 }
        );
      }
    }

    const roleLabelSource = compact(raw?.prepRoleLabel) || compact(raw?.role);
    const existingKey = compact(raw?.prepRoleKey);
    const normalized = normalizePrepRoleKey(roleLabelSource || existingKey);
    const prepRoleKey = existingKey || normalized.key;
    const prepRoleLabel = roleLabelSource || normalized.label || (prepRoleKey ? prepRoleKey : "General");

    const item = {
      prepRoleKey,
      prepRoleLabel,
      kind,
      question,
      answer,
      intuition: kind === "coding" ? intuition : intuition || "",
      status: "approved",
      approvedAt: new Date(),
    };
    if (kind === "coding") item.solutions = solutions;
    return item;
  });
}

/**
 * Append reviewed CSV questions into company platform interview content.
 * @param {{ companyId: string, items: unknown[], reviewer?: { name?: string, email?: string } }} input
 */
export async function finalizePlatformPrepCsvImport(input = {}) {
  const oid = asObjectId(input.companyId);
  if (!oid) {
    const err = new Error("Invalid company id");
    err.status = 400;
    throw err;
  }

  const staticRow = await CompanyStatic.findById(oid).lean();
  if (!staticRow) {
    const err = new Error("Company not found");
    err.status = 404;
    throw err;
  }

  const normalized = normalizeFinalizeItems(input.items);
  const reviewedBy = reviewerIdentity(input.reviewer);
  const now = new Date();

  const questionsToInsert = [];
  const roleEntries = new Map();

  for (const item of normalized) {
    const roleEntry = {
      key: item.prepRoleKey,
      label: item.prepRoleLabel || (item.prepRoleKey ? item.prepRoleKey : "General"),
    };
    if (roleEntry.key) {
      roleEntries.set(roleEntry.key, roleEntry);
    }
    const docItem = {
      prepRoleKey: item.prepRoleKey,
      kind: item.kind,
      question: item.question,
      answer: item.answer,
      intuition: item.intuition || "",
      status: "approved",
      approvedAt: now,
      createdAt: now,
    };
    if (item.kind === "coding") docItem.solutions = item.solutions;
    if (reviewedBy) docItem.reviewedBy = reviewedBy;
    questionsToInsert.push(docItem);
  }

  let doc = await CompanyPlatformContent.findOne({ companyId: oid });
  if (!doc) {
    doc = await CompanyPlatformContent.create({
      companyId: oid,
      interviewQuestions: [],
      prepRoles: [],
    });
  }

  const existingRoles = Array.isArray(doc.prepRoles) ? doc.prepRoles : [];
  const rolesToAdd = [];
  for (const entry of roleEntries.values()) {
    if (prepRoleCatalogMissing(existingRoles, entry) && entry.key) {
      rolesToAdd.push(entry);
      existingRoles.push(entry);
    }
  }

  doc.interviewQuestions.push(...questionsToInsert);
  if (rolesToAdd.length) {
    for (const entry of rolesToAdd) doc.prepRoles.push(entry);
    doc.markModified("prepRoles");
  }
  doc.markModified("interviewQuestions");
  await doc.save();
  await invalidateCompanyDetailCache(String(oid));

  const byRole = {};
  const roles = [];
  const roleSeen = new Set();
  for (const item of questionsToInsert) {
    const key = item.prepRoleKey || "";
    byRole[key] = (byRole[key] || 0) + 1;
  }
  for (const item of normalized) {
    const key = item.prepRoleKey || "";
    if (roleSeen.has(key)) continue;
    roleSeen.add(key);
    roles.push({
      key,
      label: item.prepRoleLabel || (key ? key : "General"),
    });
  }

  return {
    companyId: String(oid),
    companyName: String(staticRow.name || "").trim(),
    inserted: questionsToInsert.length,
    rolesAdded: rolesToAdd.length,
    byRole,
    roles: roles.filter((role) => role.key),
  };
}
