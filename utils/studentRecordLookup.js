/**
 * Roster rows use inconsistent column names across imports. Helpers here match
 * the way data is stored in Mongo (exact field names on documents) without
 * renaming keys on the stored document.
 */

export function normalizeRecordKeyForMatch(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Exact keys as they may appear on student profile documents after import. */
export const STUDENT_EMAIL_FIELD_CANDIDATES = [
  "Email",
  "email",
  "EMAIL",
  "E-mail",
  "E-Mail",
  "Email Address",
  "email address",
  "Email address",
  "College Email",
  "Official Email",
  "Student Email",
  "Institute Email",
  "University Email",
  "Mail ID",
  "mail id",
  "Mail",
];

export const STUDENT_USN_FIELD_CANDIDATES = [
  "USN",
  "usn",
  "Usn",
  "USN Number",
  "Student USN",
  "Reg No",
  "Registration Number",
];

const PRIMARY_COMPANY_KEY_NORMALS = new Set([
  "company",
  "companyname",
  "nameofcompany",
]);
const PRIMARY_COMPANY_PRIORITY = ["company", "companyname", "nameofcompany"];

/**
 * Prefer the same semantic “primary placement company” columns as the frontend dedupe,
 * regardless of spelling (Company, Company Name, Company_Name, …).
 */
export function resolveSemanticPrimaryCompany(studentRecord) {
  const record =
    studentRecord && typeof studentRecord === "object" ? studentRecord : {};
  const presentNorms = new Set();
  for (const key of Object.keys(record)) {
    const nk = normalizeRecordKeyForMatch(key);
    if (!PRIMARY_COMPANY_KEY_NORMALS.has(nk)) continue;
    const val = String(record[key] ?? "").trim();
    if (val) presentNorms.add(nk);
  }
  for (const norm of PRIMARY_COMPANY_PRIORITY) {
    if (!presentNorms.has(norm)) continue;
    const key = Object.keys(record).find(
      (k) =>
        normalizeRecordKeyForMatch(k) === norm &&
        String(record[k] ?? "").trim()
    );
    if (key) {
      return {
        value: String(record[key]).trim(),
        hasSemanticPrimaryColumn: true,
      };
    }
  }
  return { value: null, hasSemanticPrimaryColumn: false };
}

/**
 * @param {string} loginEmail - JWT user email (normalized lowercase upstream).
 * @param {string[]} [extraFieldNames] - e.g. env STUDENT_EMAIL_FIELD so DB keys match roster imports.
 */
export function buildLoginEmailFindQuery(loginEmail, extraFieldNames = []) {
  const trimmed = String(loginEmail || "").trim().toLowerCase();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`^\\s*${escaped}\\s*$`, "i");
  const fields = [
    ...extraFieldNames.filter((n) => typeof n === "string" && n.trim()),
    ...STUDENT_EMAIL_FIELD_CANDIDATES,
  ];
  const unique = [...new Set(fields)];
  const clauses = unique.map((fieldName) => ({
    [fieldName]: { $regex: rx },
  }));
  return { $or: clauses };
}

export function buildUsnFindQuery(usn) {
  const escaped = String(usn || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`^${escaped}$`, "i");
  const clauses = STUDENT_USN_FIELD_CANDIDATES.map((fieldName) => ({
    [fieldName]: { $regex: rx },
  }));
  return { $or: clauses };
}
