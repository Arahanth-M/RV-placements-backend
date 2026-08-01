import { normalizeRoleStipendFields } from "../services/companyService.js";

/**
 * Sanitize light HTML/script noise from free text (same spirit as adminRoutes sanitizeText).
 * @param {unknown} text
 * @returns {string}
 */
export function sanitizeRoleText(text) {
  if (text === undefined || text === null) return "";
  let str = String(text);
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  str = str.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  str = str.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  str = str.replace(
    /<\/?\s*(?:script|style|iframe|object|embed|form|svg|link|meta|base|body|html|head|img|video|audio|source|input|button|textarea|select|option|noscript)\b[^>]*>/gi,
    ""
  );
  str = str.replace(/\s+on[a-z][\w-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  str = str.replace(/(?<![/:])\bjavascript\s*:[^\s"'<>]*/gi, "");
  str = str.replace(/(?<![/:])\bdata\s*:[^\s"'<>]*/gi, "");
  return str.trim();
}

/**
 * Normalize skills the same way as workDescription: newline-separated points string.
 * Accepts array or prose/bullet text. Kept as `normalizeSkillsList` name for call sites.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeSkillsList(raw) {
  return normalizeWorkDescription(raw);
}

/**
 * Merge two points-texts without losing either side's bullets.
 * @param {unknown} prev
 * @param {unknown} incoming
 * @returns {string}
 */
function mergePointsText(prev, incoming) {
  const prevPoints = workDescriptionToPoints(prev);
  const nextPoints = workDescriptionToPoints(incoming);
  if (nextPoints.length === 0) return normalizeWorkDescription(prevPoints);
  if (prevPoints.length === 0) return normalizeWorkDescription(nextPoints);
  const seen = new Set();
  const out = [];
  for (const p of [...prevPoints, ...nextPoints]) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return normalizeWorkDescription(out);
}

/**
 * Normalize work / responsibilities into a newline-separated string (one point per line).
 * Accepts a JSON array of points or a prose/bullet string from a JD.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeWorkDescription(raw) {
  /** @type {string[]} */
  let points = [];

  if (Array.isArray(raw)) {
    points = raw
      .map((item) =>
        sanitizeRoleText(item)
          .replace(/^[-*•]+\s*/, "")
          .replace(/^\d+[.)]\s*/, "")
      )
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (raw !== null && raw !== undefined) {
    const text = sanitizeRoleText(raw);
    if (!text) return "";

    // Split on newlines OR inline bullet/number markers.
    const roughParts = text
      .split(/\r?\n+|(?=\s*[•●▪▸►])|(?=\s+\d+[.)]\s+)/)
      .flatMap((chunk) => chunk.split(/(?:^|\s)[-*]\s+/));

    points = roughParts
      .map((line) =>
        sanitizeRoleText(line)
          .replace(/^[-*•●▪▸►]+\s*/, "")
          .replace(/^\d+[.)]\s*/, "")
          .trim()
      )
      .filter(Boolean);

    // Single prose sentence with no list markers → keep as one block.
    if (
      points.length <= 1 &&
      !/[\n\r]/.test(text) &&
      !/[-*•●]/.test(text) &&
      !/\d+[.)]\s/.test(text)
    ) {
      return text;
    }
  }

  if (points.length === 0) return "";
  if (points.length === 1) return points[0];
  return points.join("\n");
}

/**
 * Split a stored workDescription into display points (array or string).
 * @param {unknown} raw
 * @returns {string[]}
 */
export function workDescriptionToPoints(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((item) =>
        String(item ?? "")
          .replace(/^[-*•●▪▸►]+\s*/, "")
          .replace(/^\d+[.)]\s*/, "")
          .trim()
      )
      .filter(Boolean);
  }
  const normalized = normalizeWorkDescription(raw);
  if (!normalized) return [];
  if (!normalized.includes("\n")) return [normalized];
  return normalized
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string} normalizedKey lowercased, spaces removed
 */
function isExactSkillsStoreKey(normalizedKey) {
  const nk = String(normalizedKey || "");
  return nk === "skills" || nk === "skill";
}

/**
 * @param {string} normalizedKey lowercased, spaces removed
 */
function isExactWorkStoreKey(normalizedKey) {
  const nk = String(normalizedKey || "");
  return nk === "workdescription" || nk === "work";
}

/**
 * Canonical Mongo key for a JD "Save as" name.
 * Only exact skills / workDescription aliases collapse; everything else keeps its label.
 * @param {string} cleanKey
 */
export function canonicalJdStoreKey(cleanKey) {
  const trimmed = sanitizeRoleText(cleanKey);
  if (!trimmed) return "";
  const nk = trimmed.toLowerCase().replace(/\s+/g, "");
  if (isExactSkillsStoreKey(nk)) return "skills";
  if (isExactWorkStoreKey(nk)) return "workDescription";
  return trimmed;
}

/**
 * Money / compensation keys must never be written as role point fields.
 * @param {string} normalizedKey lowercased, spaces removed
 */
function isCompensationFieldKey(normalizedKey) {
  const nk = String(normalizedKey || "");
  if (!nk) return false;
  if (
    nk === "ctc" ||
    nk === "base" ||
    nk === "stipend" ||
    nk === "internshipstipend" ||
    nk === "bonus" ||
    nk === "stock" ||
    nk === "rsu" ||
    nk === "equity" ||
    nk === "joiningbonus" ||
    nk === "variable" ||
    nk === "variables" ||
    nk === "rolename" ||
    nk === "name"
  ) {
    return true;
  }
  return /^(ctc|base|stipend|salary|compensation)/.test(nk);
}

/** Reserved role keys that are not free-form point sections. */
export const ROLE_STRUCTURAL_KEYS = new Set([
  "rolename",
  "name",
  "ctc",
  "internshipstipend",
  "stipend",
  "_id",
  "id",
]);

/**
 * Collect point-style sections on a role, keyed exactly as stored.
 * @param {Record<string, unknown>|null|undefined} role
 * @returns {{ key: string, points: string[] }[]}
 */
export function listRolePointSections(role) {
  if (!role || typeof role !== "object") return [];
  /** @type {{ key: string, points: string[] }[]} */
  const out = [];
  for (const [key, value] of Object.entries(role)) {
    const nk = String(key || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
    if (!nk || ROLE_STRUCTURAL_KEYS.has(nk)) continue;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      continue;
    }
    const points = workDescriptionToPoints(value);
    if (points.length === 0) continue;
    out.push({ key, points });
  }
  return out;
}

/**
 * Plain-object copy of a role with `ctc` always a plain object (never wipe).
 * @param {Record<string, unknown>} role
 */
function cloneRolePreservingCtc(role) {
  const ctc =
    role.ctc instanceof Map
      ? Object.fromEntries(role.ctc)
      : role.ctc && typeof role.ctc === "object" && !Array.isArray(role.ctc)
        ? { ...role.ctc }
        : {};
  return {
    ...role,
    roleName: role.roleName ?? role.name ?? "",
    ctc,
    skills: normalizeSkillsList(role.skills),
    workDescription: normalizeWorkDescription(
      role.workDescription ?? role.work ?? ""
    ),
  };
}

/**
 * Normalize one admin role object for persistence.
 * Empty roleName is allowed when skills/work/ctc/stipend are present.
 * @param {unknown} role
 * @param {number} index
 * @returns {Record<string, unknown>}
 */
export function normalizeAdminRoleInput(role, index = 0) {
  const rawName = role?.roleName ?? role?.name ?? "";
  const roleName = sanitizeRoleText(rawName);

  const stipStr = String(role?.internshipStipend ?? "").trim();
  let internshipStipend;
  if (stipStr && !/^n\/a$/i.test(stipStr)) {
    const n = Number(stipStr.replace(/,/g, ""));
    if (Number.isNaN(n) || n < 0) {
      throw new Error(
        `Role at index ${index}${roleName ? ` ("${roleName}")` : ""}: internshipStipend must be a non‑negative number or N/A`
      );
    }
    if (n > 0) internshipStipend = n;
  }

  const rawCtc = role?.ctc && typeof role.ctc === "object" ? role.ctc : {};
  const ctc = {};
  Object.entries(rawCtc).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    const cleanKey = sanitizeRoleText(key);
    if (!cleanKey) return;
    const numeric = Number(value);
    ctc[cleanKey] = Number.isNaN(numeric) ? String(value).trim() : numeric;
  });

  const skills = normalizeSkillsList(role?.skills);
  const workDescription = normalizeWorkDescription(
    role?.workDescription ?? role?.work ?? ""
  );

  /** @type {Record<string, string>} */
  const extraPointFields = {};
  if (role && typeof role === "object") {
    for (const [key, value] of Object.entries(role)) {
      const nk = String(key || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
      if (!nk || ROLE_STRUCTURAL_KEYS.has(nk)) continue;
      if (nk === "skills" || nk === "workdescription" || nk === "work") continue;
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        continue;
      }
      const text = normalizeSkillsList(value);
      if (text) extraPointFields[sanitizeRoleText(key) || key] = text;
    }
  }

  const hasCtc = Object.keys(ctc).length > 0;
  const hasContent =
    Boolean(roleName) ||
    hasCtc ||
    internshipStipend !== undefined ||
    Boolean(skills) ||
    Boolean(workDescription) ||
    Object.keys(extraPointFields).length > 0;

  if (!hasContent) {
    throw new Error(
      `Role at index ${index} is empty (need roleName, CTC, stipend, skills, or workDescription)`
    );
  }

  return normalizeRoleStipendFields({
    roleName,
    ctc,
    ...(internshipStipend !== undefined ? { internshipStipend } : {}),
    ...(skills ? { skills } : {}),
    ...(workDescription ? { workDescription } : {}),
    ...extraPointFields,
  });
}

/** Top-level role fields that should not be stuffed into `ctc`. */
export const ROLE_NON_CTC_FIELD_KEYS = new Set([
  "skills",
  "workdescription",
  "work",
  "responsibilities",
  "internshipstipend",
  "stipend",
  "rolename",
  "name",
  "ctc",
]);

/**
 * True when a compensation value is real enough to overwrite an existing CTC key.
 * Placeholders / empty / non-values must NOT wipe stored CTC.
 * @param {unknown} value
 */
export function isUsableCompensationValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return false;
  if (typeof value === "object") return false;
  const s = String(value).trim();
  if (!s) return false;
  if (
    /^(n\/?a|na|none|null|undefined|nil|not\s+(specified|mentioned|found|available|provided)|unknown|-|—|–|\.|tbd|tba)$/i.test(
      s
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Merge incoming CTC keys onto existing without clearing keys for blank/placeholder values.
 * @param {Record<string, unknown>} prevCtc
 * @param {Record<string, unknown>} incomingCtc
 */
export function mergeCtcMapsPreserveExisting(prevCtc, incomingCtc) {
  /** @type {Record<string, unknown>} */
  const out = { ...(prevCtc && typeof prevCtc === "object" ? prevCtc : {}) };
  for (const [key, value] of Object.entries(
    incomingCtc && typeof incomingCtc === "object" ? incomingCtc : {}
  )) {
    if (!isUsableCompensationValue(value)) continue;
    const cleanKey = sanitizeRoleText(key);
    if (!cleanKey) continue;
    out[cleanKey] = value;
  }
  return out;
}

/**
 * Split a flat JD payload into point-field patches keyed by Save-as name.
 * Only exact `skills` / `work` / `workDescription` collapse to canonical keys;
 * names like "Bonus Skills" stay as their own stored key.
 * JD import must never treat payload keys as CTC/compensation.
 * @param {Record<string, unknown>} payload
 */
export function splitJdPayloadFields(payload) {
  const src = payload && typeof payload === "object" ? payload : {};
  /** @type {Record<string, string>} */
  const fields = {};

  for (const [key, value] of Object.entries(src)) {
    if (value === null || value === undefined || value === "") continue;
    const cleanKey = sanitizeRoleText(key);
    if (!cleanKey) continue;
    const nk = cleanKey.toLowerCase().replace(/\s+/g, "");
    if (isCompensationFieldKey(nk)) continue;

    const storeKey = canonicalJdStoreKey(cleanKey);
    if (!storeKey) continue;
    const text = normalizeSkillsList(value);
    if (!text) continue;
    fields[storeKey] = fields[storeKey]
      ? mergePointsText(fields[storeKey], text)
      : text;
  }

  const skills = fields.skills || "";
  const workDescription = fields.workDescription || "";

  return {
    fields,
    skills,
    workDescription,
    internshipStipend: undefined,
    ctc: {},
    hasSkillsKey: Object.prototype.hasOwnProperty.call(fields, "skills"),
    hasWorkKey: Object.prototype.hasOwnProperty.call(fields, "workDescription"),
    hasAnyPointField: Object.keys(fields).length > 0,
    hasStipendKey: false,
  };
}

/**
 * Resolve which role index JD skills/work should attach to.
 * @param {Record<string, unknown>[]} roles
 * @param {string} roleName
 */
export function findJdTargetRoleIndex(roles, roleName) {
  const name = sanitizeRoleText(roleName);
  if (name) {
    return roles.findIndex(
      (r) =>
        String(r.roleName ?? "")
          .trim()
          .toLowerCase() === name.toLowerCase()
    );
  }
  // Prefer attaching skills/work onto the sole existing role when role name unknown.
  if (roles.length === 1) return 0;
  return roles.findIndex((r) => !String(r.roleName ?? "").trim());
}

/**
 * Plan a surgical JD update: patch point fields on one role, or push a new role.
 * Never includes `ctc` / `internshipStipend` in the plan.
 * @param {unknown[]} existingRoles
 * @param {string} roleName
 * @param {Record<string, unknown>} payload
 * @returns {{ kind: 'noop' } | { kind: 'patch', index: number, fields: Record<string, string> } | { kind: 'push', role: Record<string, string> }}
 */
export function planJdRoleFieldUpdate(existingRoles, roleName, payload) {
  const roles = (Array.isArray(existingRoles) ? existingRoles : []).filter(
    (r) => r && typeof r === "object"
  );
  const name = sanitizeRoleText(roleName);
  const split = splitJdPayloadFields(payload);

  if (!split.hasAnyPointField) {
    return { kind: "noop" };
  }

  const idx = findJdTargetRoleIndex(
    /** @type {Record<string, unknown>[]} */ (roles),
    name
  );

  if (idx >= 0) {
    const prev = /** @type {Record<string, unknown>} */ (roles[idx]);
    /** @type {Record<string, string>} */
    const fields = {};

    for (const [storeKey, incoming] of Object.entries(split.fields)) {
      const merged = incoming
        ? mergePointsText(prev[storeKey], incoming)
        : normalizeSkillsList(prev[storeKey]);
      if (merged) fields[storeKey] = merged;
    }

    // Optionally fill blank roleName from JD when attaching to an unnamed/matched role.
    if (name && !String(prev.roleName ?? "").trim()) {
      fields.roleName = name;
    }

    if (Object.keys(fields).length === 0) {
      return { kind: "noop" };
    }
    return { kind: "patch", index: idx, fields };
  }

  /** @type {Record<string, string>} */
  const role = { roleName: name, ...split.fields };
  if (Object.keys(split.fields).length === 0) {
    return { kind: "noop" };
  }
  return { kind: "push", role };
}

/**
 * Upsert JD skills/work into a roles array (in-memory; used by tests).
 * Never modifies existing `ctc` / `internshipStipend` on any role.
 * Prefer `planJdRoleFieldUpdate` + Mongo `$set`/`$push` for persistence.
 * @param {unknown[]} existingRoles
 * @param {string} roleName
 * @param {Record<string, unknown>} payload
 */
export function mergeJdPayloadIntoRoles(existingRoles, roleName, payload) {
  const roles = (Array.isArray(existingRoles) ? existingRoles : [])
    .filter((r) => r && typeof r === "object")
    .map((r) => cloneRolePreservingCtc(/** @type {Record<string, unknown>} */ (r)));

  const plan = planJdRoleFieldUpdate(roles, roleName, payload);
  if (plan.kind === "noop") return roles;

  if (plan.kind === "patch") {
    const prev = roles[plan.index];
    roles[plan.index] = {
      ...prev,
      ...plan.fields,
      // Hard-preserve compensation — never from JD payload / plan fields.
      ctc:
        prev.ctc && typeof prev.ctc === "object" && !Array.isArray(prev.ctc)
          ? { ...prev.ctc }
          : {},
    };
    if (
      prev.internshipStipend !== undefined &&
      prev.internshipStipend !== null &&
      String(prev.internshipStipend).trim() !== ""
    ) {
      roles[plan.index].internshipStipend = prev.internshipStipend;
    }
    return roles;
  }

  roles.push({
    ...plan.role,
    ctc: {},
  });
  return roles;
}
