/**
 * Multi-college scoping for visit `roles` / `placementGotInBranchStats`.
 * College is derived from institutional email (JWT may also carry collegeId).
 *
 * RVCE:  *@rvce.edu.in
 * RVITM: *.rvitm@rvei.edu.in
 */

export const COLLEGE_ID_RVCE = "rvce";
export const COLLEGE_ID_RVITM = "rvitm";

/** Legacy rows without collegeId are treated as RVCE. */
export const DEFAULT_COLLEGE_ID = COLLEGE_ID_RVCE;

const RVCE_EMAIL_SUFFIX = "@rvce.edu.in";
const RVITM_EMAIL_SUFFIX = ".rvitm@rvei.edu.in";

/** TEMP: Gmail accounts treated as RVITM for local testing. Remove before deploy. */
const TEST_RVITM_EMAILS = new Set(["arahanthmahaveer76@gmail.com","akshathaanilkumar@gmail.com"]);

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeCollegeId(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === COLLEGE_ID_RVITM) return COLLEGE_ID_RVITM;
  if (s === COLLEGE_ID_RVCE) return COLLEGE_ID_RVCE;
  return DEFAULT_COLLEGE_ID;
}

/**
 * @param {unknown} email
 * @returns {string} collegeId (defaults to rvce when pattern unknown)
 */
export function collegeIdFromEmail(email) {
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  if (TEST_RVITM_EMAILS.has(normalized)) return COLLEGE_ID_RVITM;
  if (normalized.endsWith(RVITM_EMAIL_SUFFIX)) return COLLEGE_ID_RVITM;
  if (normalized.endsWith(RVCE_EMAIL_SUFFIX)) return COLLEGE_ID_RVCE;
  return DEFAULT_COLLEGE_ID;
}

/**
 * Prefer JWT `collegeId`, else derive from email.
 * @param {{ collegeId?: unknown, email?: unknown }|null|undefined} user
 * @returns {string}
 */
export function collegeIdFromUser(user) {
  if (user?.collegeId != null && String(user.collegeId).trim() !== "") {
    return normalizeCollegeId(user.collegeId);
  }
  return collegeIdFromEmail(user?.email);
}

/**
 * True when email maps to the given college (same rules as {@link collegeIdFromEmail}).
 * @param {unknown} email
 * @param {unknown} collegeIdRaw
 * @returns {boolean}
 */
export function emailBelongsToCollege(email, collegeIdRaw) {
  return collegeIdFromEmail(email) === normalizeCollegeId(collegeIdRaw);
}

/**
 * True when email matches an allowed institutional college pattern.
 * @param {unknown} email
 * @returns {boolean}
 */
export function isAllowedCollegeEmail(email) {
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  return (
    TEST_RVITM_EMAILS.has(normalized) ||
    normalized.endsWith(RVCE_EMAIL_SUFFIX) ||
    normalized.endsWith(RVITM_EMAIL_SUFFIX)
  );
}

/**
 * Mongo `$match` fragment that scopes documents by institutional email college.
 * Mirrors {@link collegeIdFromEmail}: RVITM = `*.rvitm@rvei.edu.in` (+ test list);
 * RVCE = everyone else (incl. `@rvce.edu.in` and unknown/legacy → treated as RVCE).
 * Read-only filter — does not alter stored data.
 *
 * @param {unknown} collegeIdRaw — `rvce` | `rvitm`
 * @param {string} [emailFieldPath="email"] — e.g. `"email"` or `"submittedBy.email"`
 * @returns {Record<string, unknown>}
 */
export function mongoMatchEmailFieldForCollege(
  collegeIdRaw,
  emailFieldPath = "email"
) {
  const collegeId = normalizeCollegeId(collegeIdRaw);
  const field = String(emailFieldPath || "email").trim() || "email";
  const rvitmRegex = {
    [field]: { $regex: "\\.rvitm@rvei\\.edu\\.in$", $options: "i" },
  };
  const testEmails = [...TEST_RVITM_EMAILS];
  /** @type {Record<string, unknown>[]} */
  const rvitmClauses = [rvitmRegex];
  if (testEmails.length > 0) {
    rvitmClauses.push({ [field]: { $in: testEmails } });
  }

  if (collegeId === COLLEGE_ID_RVITM) {
    return rvitmClauses.length === 1 ? rvitmClauses[0] : { $or: rvitmClauses };
  }

  // RVCE admin: exclude RVITM (and test RVITM emails)
  return rvitmClauses.length === 1
    ? { $nor: rvitmClauses }
    : { $and: rvitmClauses.map((c) => ({ $nor: [c] })) };
}

/**
 * Merge a base match with college email scope (avoids clobbering `$or` / `$nor`).
 * @param {Record<string, unknown>|null|undefined} baseMatch
 * @param {unknown} collegeIdRaw
 * @param {string} [emailFieldPath="email"]
 * @returns {Record<string, unknown>}
 */
export function withCollegeEmailScope(
  baseMatch,
  collegeIdRaw,
  emailFieldPath = "email"
) {
  const scope = mongoMatchEmailFieldForCollege(collegeIdRaw, emailFieldPath);
  const base =
    baseMatch && typeof baseMatch === "object" && Object.keys(baseMatch).length > 0
      ? baseMatch
      : null;
  if (!base) return scope;
  return { $and: [base, scope] };
}

/**
 * Effective college on a role / got-in row (missing → rvce).
 * @param {unknown} row
 * @returns {string}
 */
export function collegeIdOfScopedRow(row) {
  if (!row || typeof row !== "object") return DEFAULT_COLLEGE_ID;
  const raw = /** @type {{ collegeId?: unknown }} */ (row).collegeId;
  if (raw == null || String(raw).trim() === "") return DEFAULT_COLLEGE_ID;
  return normalizeCollegeId(raw);
}

/**
 * True when a role has usable CTC object values or a positive internship stipend.
 * Used to omit empty RVITM compensation rows from student-facing payloads (read-time only).
 * @param {unknown} role
 * @returns {boolean}
 */
export function roleHasUsableCompensationForDisplay(role) {
  if (!role || typeof role !== "object") return false;
  const stip = Number(/** @type {{ internshipStipend?: unknown }} */ (role).internshipStipend);
  if (Number.isFinite(stip) && stip > 0) return true;

  const raw = /** @type {{ ctc?: unknown }} */ (role).ctc;
  const obj =
    raw instanceof Map
      ? Object.fromEntries(raw)
      : raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw
        : null;
  if (!obj) return false;
  for (const v of Object.values(obj)) {
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return true;
    if (typeof v === "string") {
      const s = v.trim();
      if (!s || /^n\/?a$/i.test(s)) continue;
      if (/\d/.test(s)) return true;
    }
  }
  return false;
}

/**
 * @param {unknown[]} roles
 * @param {unknown} collegeIdRaw
 * @returns {unknown[]}
 */
export function filterRolesForCollege(roles, collegeIdRaw) {
  const collegeId = normalizeCollegeId(collegeIdRaw);
  if (!Array.isArray(roles)) return [];
  return roles.filter((r) => collegeIdOfScopedRow(r) === collegeId);
}

/**
 * @param {unknown[]} rows
 * @param {unknown} collegeIdRaw
 * @returns {unknown[]}
 */
export function filterPlacementGotInForCollege(rows, collegeIdRaw) {
  const collegeId = normalizeCollegeId(collegeIdRaw);
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => collegeIdOfScopedRow(r) === collegeId);
}

/**
 * Keep other colleges' roles; replace this college's slice with stamped incoming.
 * @param {unknown[]} existingRoles
 * @param {unknown[]} incomingRoles
 * @param {unknown} collegeIdRaw
 * @returns {unknown[]}
 */
export function mergeRolesForCollege(existingRoles, incomingRoles, collegeIdRaw) {
  const collegeId = normalizeCollegeId(collegeIdRaw);
  const keep = Array.isArray(existingRoles)
    ? existingRoles.filter((r) => collegeIdOfScopedRow(r) !== collegeId)
    : [];
  const stamped = Array.isArray(incomingRoles)
    ? incomingRoles
        .filter((r) => r && typeof r === "object")
        .map((r) => ({
          .../** @type {Record<string, unknown>} */ (r),
          collegeId,
        }))
    : [];
  return [...keep, ...stamped];
}

/**
 * Keep other colleges' branch stats; replace this college's slice with stamped incoming.
 * @param {unknown[]} existingRows
 * @param {unknown[]} incomingRows
 * @param {unknown} collegeIdRaw
 * @returns {unknown[]}
 */
export function mergePlacementGotInForCollege(existingRows, incomingRows, collegeIdRaw) {
  const collegeId = normalizeCollegeId(collegeIdRaw);
  const keep = Array.isArray(existingRows)
    ? existingRows.filter((r) => collegeIdOfScopedRow(r) !== collegeId)
    : [];
  const stamped = Array.isArray(incomingRows)
    ? incomingRows
        .filter((r) => r && typeof r === "object")
        .map((r) => ({
          .../** @type {Record<string, unknown>} */ (r),
          collegeId,
        }))
    : [];
  return [...keep, ...stamped];
}

/**
 * Sum gotIn across placementGotInBranchStats (optionally college-scoped).
 * @param {unknown[]} rows
 * @param {unknown} [collegeIdRaw] — when set, only that college
 * @returns {number}
 */
export function sumPlacementGotIn(rows, collegeIdRaw = null) {
  const list =
    collegeIdRaw == null
      ? Array.isArray(rows)
        ? rows
        : []
      : filterPlacementGotInForCollege(rows, collegeIdRaw);
  return list.reduce((sum, row) => {
    const n = Number(/** @type {{ gotIn?: unknown }} */ (row)?.gotIn);
    return sum + (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }, 0);
}

/**
 * PPO conversion aggregates from college-scoped `ppoBranchStats` rows.
 * @param {unknown[]} rows
 * @returns {{
 *   ppoConversionGotIn: number,
 *   ppoConversionConverted: number,
 *   ppoConversionNotApplicable: boolean,
 *   ppoConversionAcceptanceRate: number,
 * }}
 */
function ppoConversionAggregatesFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const gotInTotal = list.reduce((sum, item) => {
    const n = Number(/** @type {{ gotIn?: unknown }} */ (item)?.gotIn);
    return sum + (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }, 0);
  const gotInTotalWithKnownConversion = list.reduce((sum, item) => {
    const row = /** @type {{ gotIn?: unknown, convertedNotApplicable?: unknown }} */ (item);
    if (row?.convertedNotApplicable) return sum;
    const n = Number(row?.gotIn);
    return sum + (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }, 0);
  const convertedTotal = list.reduce((sum, item) => {
    const row = /** @type {{ converted?: unknown, convertedNotApplicable?: unknown }} */ (item);
    if (row?.convertedNotApplicable) return sum;
    const n = Number(row?.converted);
    return sum + (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }, 0);
  return {
    ppoConversionGotIn: gotInTotal,
    ppoConversionConverted: convertedTotal,
    ppoConversionNotApplicable: list.some(
      (item) => Boolean(/** @type {{ convertedNotApplicable?: unknown }} */ (item)?.convertedNotApplicable)
    ),
    ppoConversionAcceptanceRate:
      gotInTotalWithKnownConversion > 0
        ? Number(((convertedTotal / gotInTotalWithKnownConversion) * 100).toFixed(2))
        : 0,
  };
}

/**
 * Filter API-facing company payload so roles / got-in / PPO stats are college-scoped.
 * Mutates a shallow copy; safe to call on cached payloads before respond.
 * @param {Record<string, unknown>|null|undefined} company
 * @param {unknown} collegeIdRaw
 * @returns {Record<string, unknown>|null|undefined}
 */
export function applyCollegeScopeToCompanyPayload(company, collegeIdRaw) {
  if (!company || typeof company !== "object") return company;
  const collegeId = normalizeCollegeId(collegeIdRaw);
  const out = { ...company };

  if (Array.isArray(out.roles)) {
    let roles = filterRolesForCollege(out.roles, collegeId);
    // RVITM: omit roles with no CTC and no internship stipend from API payloads.
    if (collegeId === COLLEGE_ID_RVITM) {
      roles = roles.filter((r) => roleHasUsableCompensationForDisplay(r));
    }
    out.roles = roles;
  }

  if (