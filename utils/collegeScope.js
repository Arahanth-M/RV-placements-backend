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
const TEST_RVITM_EMAILS = new Set(["arahanthmahaveer76@gmail.com"]);

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
 * Filter API-facing company payload so roles / got-in are college-scoped.
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

  if (Array.isArray(out.placementGotInBranchStats)) {
    out.placementGotInBranchStats = filterPlacementGotInForCollege(
      out.placementGotInBranchStats,
      collegeId
    );
    out.totalGotIn = sumPlacementGotIn(out.placementGotInBranchStats);
  }

  if (out.totalGotInByYear && typeof out.totalGotInByYear === "object") {
    const byYear = /** @type {Record<string, unknown>} */ (out.totalGotInByYear);
    const next = { ...byYear };
    const branchByYear = out.placementBranchStatsByYear;
    if (branchByYear && typeof branchByYear === "object") {
      for (const y of Object.keys(next)) {
        const rows = /** @type {Record<string, unknown>} */ (branchByYear)[y];
        if (Array.isArray(rows)) {
          next[y] = sumPlacementGotIn(rows);
        }
      }
    }
    out.totalGotInByYear = next;
  }

  if (out.placementBranchStatsByYear && typeof out.placementBranchStatsByYear === "object") {
    // Rows are already collapsed without collegeId at build time when college filter
    // was applied upstream; if still present as multi-college raw, filter here.
    const src = /** @type {Record<string, unknown>} */ (out.placementBranchStatsByYear);
    /** @type {Record<string, unknown>} */
    const next = {};
    for (const [y, rows] of Object.entries(src)) {
      if (!Array.isArray(rows)) {
        next[y] = rows;
        continue;
      }
      const hasCollege = rows.some(
        (r) => r && typeof r === "object" && "collegeId" in /** @type {object} */ (r)
      );
      next[y] = hasCollege ? filterPlacementGotInForCollege(rows, collegeId) : rows;
    }
    out.placementBranchStatsByYear = next;
  }

  return out;
}
