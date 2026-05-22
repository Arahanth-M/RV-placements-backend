/**
 * LMPP Type-1 style merge: SPC compensation into visit `roles[]` with TBD-aware
 * field merge and close/far numeric comparison.
 */
import { parseCtcStringToRupees, RUPEES_PER_LPA } from "../utils/ctcCategory.js";

/** Within 10% or ₹5 LPA — same package band. */
export const SPC_COMP_CLOSE_RELATIVE = 0.1;
export const SPC_COMP_CLOSE_ABSOLUTE_RUPEES = 5 * RUPEES_PER_LPA;

const PLACEMENT_DETAILS_FALLBACK = "Placement details";

/** @param {unknown} name */
export function isSpcRolePlaceholderName(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return true;
  if (n === "placement details") return true;
  return n === "tbd" || n === "tba";
}

/** @param {unknown} str */
export function isCompensationPlaceholder(str) {
  const s = String(str ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  return lower === "tbd" || lower === "tba" || lower === "n/a" || lower === "na";
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
export function roleNamesMatch(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

/**
 * @param {unknown} raw
 * @returns {{ kind: "placeholder" } | { kind: "numeric", rupees: number } | { kind: "text" }}
 */
export function classifyCompensationValue(raw) {
  if (isCompensationPlaceholder(raw)) return { kind: "placeholder" };
  const rupees = parseCtcStringToRupees(raw);
  if (rupees != null && rupees > 0) return { kind: "numeric", rupees };
  const s = String(raw ?? "").trim();
  if (/^\d[\d,.\s]*$/.test(s)) {
    const n = Number(s.replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return { kind: "numeric", rupees: n };
  }
  if (s) return { kind: "text" };
  return { kind: "placeholder" };
}

/**
 * @param {number} a
 * @param {number} b
 */
export function compensationRupeesClose(a, b) {
  const diff = Math.abs(a - b);
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return (
    diff <= SPC_COMP_CLOSE_ABSOLUTE_RUPEES || diff / denom <= SPC_COMP_CLOSE_RELATIVE
  );
}

/**
 * Case 5: never write TBD over a known value; fill blanks from submission.
 * @param {unknown} existingRaw
 * @param {unknown} submittedRaw
 * @returns {string}
 */
export function mergeCompensationField(existingRaw, submittedRaw) {
  const sub = classifyCompensationValue(submittedRaw);
  if (sub.kind === "placeholder") {
    return String(existingRaw ?? "").trim();
  }
  const ex = classifyCompensationValue(existingRaw);
  if (ex.kind === "placeholder" || ex.kind === "text") {
    return String(submittedRaw).trim();
  }
  if (sub.kind === "numeric" && ex.kind === "numeric") {
    return String(submittedRaw).trim();
  }
  return String(existingRaw ?? "").trim();
}

/**
 * @param {{ ctcStr?: string, baseStr?: string, stipendStr?: string }} comp
 */
export function allCompensationPlaceholder(comp) {
  return (
    isCompensationPlaceholder(comp.ctcStr) &&
    isCompensationPlaceholder(comp.baseStr) &&
    isCompensationPlaceholder(comp.stipendStr)
  );
}

/**
 * @param {{ ctcStr?: string, baseStr?: string, stipendStr?: string }} comp
 */
export function hasAnyCompensation(comp) {
  return Boolean(
    !isCompensationPlaceholder(comp.ctcStr) ||
      !isCompensationPlaceholder(comp.baseStr) ||
      !isCompensationPlaceholder(comp.stipendStr)
  );
}

/**
 * @param {unknown} stipStr
 * @returns {number|undefined}
 */
function stipendToNumber(stipStr) {
  const s = String(stipStr ?? "").trim();
  if (isCompensationPlaceholder(s)) return undefined;
  const direct = Number(s.replace(/,/g, ""));
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const parsed = parseCtcStringToRupees(s);
  return parsed != null && parsed > 0 ? parsed : undefined;
}

/**
 * One canonical key per compensation field — avoids duplicate UI tiles when legacy rows used `ctc` vs `CTC`.
 * @param {Record<string, unknown>} ctc
 */
export function collapseRoleCtcKeyAliases(ctc) {
  if (!ctc || typeof ctc !== "object") return {};
  /** @type {Record<string, unknown>} */
  const next = { ...ctc };

  const ctcVal = next.CTC ?? next.Ctc ?? next.ctc;
  delete next.CTC;
  delete next.Ctc;
  delete next.ctc;
  if (ctcVal !== undefined && String(ctcVal).trim() !== "") {
    next.CTC = ctcVal;
  }

  const baseVal = next.Base ?? next.base;
  delete next.Base;
  delete next.base;
  if (baseVal !== undefined && String(baseVal).trim() !== "") {
    next.Base = baseVal;
  }

  return next;
}

/**
 * @param {{ roleName: string, ctc: Record<string, unknown>, internshipStipend?: number }} role
 * @param {{ ctcStr?: string, baseStr?: string, stipendStr?: string }} comp
 */
function roleHasCloseCompensation(role, comp) {
  const ctc = role.ctc && typeof role.ctc === "object" ? role.ctc : {};
  const ctcEx = ctc.CTC ?? ctc.Ctc ?? ctc.ctc;
  const baseEx = ctc.Base ?? ctc.base;

  if (
    !isCompensationPlaceholder(comp.ctcStr) &&
    classifyCompensationValue(ctcEx).kind === "numeric" &&
    classifyCompensationValue(comp.ctcStr).kind === "numeric" &&
    compensationRupeesClose(
      /** @type {{ kind: "numeric", rupees: number }} */ (classifyCompensationValue(ctcEx)).rupees,
      /** @type {{ kind: "numeric", rupees: number }} */ (classifyCompensationValue(comp.ctcStr)).rupees
    )
  ) {
    return true;
  }
  if (
    !isCompensationPlaceholder(comp.baseStr) &&
    classifyCompensationValue(baseEx).kind === "numeric" &&
    classifyCompensationValue(comp.baseStr).kind === "numeric" &&
    compensationRupeesClose(
      /** @type {{ kind: "numeric", rupees: number }} */ (classifyCompensationValue(baseEx)).rupees,
      /** @type {{ kind: "numeric", rupees: number }} */ (classifyCompensationValue(comp.baseStr)).rupees
    )
  ) {
    return true;
  }
  const stipNum = stipendToNumber(comp.stipendStr);
  const prevStip = Number(role.internshipStipend);
  if (
    stipNum !== undefined &&
    Number.isFinite(prevStip) &&
    prevStip > 0 &&
    compensationRupeesClose(prevStip, stipNum)
  ) {
    return true;
  }
  return false;
}

/**
 * @param {{ roleName: string, ctc: Record<string, unknown>, internshipStipend?: number }} prev
 * @param {{ ctcStr?: string, baseStr?: string, stipendStr?: string }} comp
 * @param {{ roleName?: string }} [opts]
 */
function mergeIntoRole(prev, comp, opts = {}) {
  const ctc =
    prev.ctc && typeof prev.ctc === "object"
      ? { .../** @type {Record<string, unknown>} */ (prev.ctc) }
      : {};

  if (!isCompensationPlaceholder(comp.ctcStr)) {
    const merged = mergeCompensationField(
      ctc.CTC ?? ctc.Ctc ?? ctc.ctc,
      comp.ctcStr
    );
    delete ctc.CTC;
    delete ctc.Ctc;
    delete ctc.ctc;
    if (String(merged).trim()) ctc.CTC = merged;
  }
  if (!isCompensationPlaceholder(comp.baseStr)) {
    const merged = mergeCompensationField(ctc.Base ?? ctc.base, comp.baseStr);
    delete ctc.Base;
    delete ctc.base;
    if (String(merged).trim()) ctc.Base = merged;
  }

  /** @type {{ roleName: string, ctc: Record<string, unknown>, internshipStipend?: number }} */
  const next = {
    roleName: opts.roleName != null ? String(opts.roleName).trim() : prev.roleName,
    ctc: collapseRoleCtcKeyAliases(ctc),
  };
  const stipNum = stipendToNumber(comp.stipendStr);
  if (stipNum !== undefined) {
    next.internshipStipend = stipNum;
  } else if (Number.isFinite(Number(prev.internshipStipend))) {
    next.internshipStipend = prev.internshipStipend;
  }
  return next;
}

/**
 * @param {{ roleName: string, ctc: Record<string, unknown>, internshipStipend?: number }}[] roles
 * @param {string} concreteRoleName
 */
function dropPlaceholderRolesExcept(roles, concreteRoleName) {
  return roles.filter(
    (row) =>
      roleNamesMatch(row.roleName, concreteRoleName) ||
      !isSpcRolePlaceholderName(row.roleName)
  );
}

/**
 * @param {unknown[]} existingRoles
 * @param {{ roleName?: string, ctcStr?: string, baseStr?: string, stipendStr?: string }} patch
 * @returns {Array<{ roleName: string, ctc: Record<string, unknown>, internshipStipend?: number }>}
 */
export function mergeSpcOfferIntoVisitRoles(existingRoles, patch) {
  /** @type {{ roleName: string, ctc: Record<string, unknown>, internshipStipend?: number }[]} */
  const roles = [];
  if (Array.isArray(existingRoles)) {
    for (const r of existingRoles) {
      if (!r || typeof r !== "object") continue;
      const roleName = String(r.roleName ?? r.name ?? "").trim() || "Role";
      const ctc =
        r.ctc && typeof r.ctc === "object"
          ? { .../** @type {Record<string, unknown>} */ (r.ctc) }
          : {};
      /** @type {{ roleName: string, ctc: Record<string, unknown>, internshipStipend?: number }} */
      const entry = { roleName, ctc };
      const st = Number(r.internshipStipend);
      if (Number.isFinite(st) && st > 0) entry.internshipStipend = st;
      roles.push(entry);
    }
  }

  const comp = {
    ctcStr: String(patch.ctcStr ?? "").trim(),
    baseStr: String(patch.baseStr ?? "").trim(),
    stipendStr: String(patch.stipendStr ?? "").trim(),
  };
  const roleTrim = String(patch.roleName ?? "").trim().slice(0, 200);
  const roleIsPlaceholder = isSpcRolePlaceholderName(roleTrim);
  const anyComp = hasAnyCompensation(comp);

  // Case 6: TBD role + all comp placeholders → no card change
  if (allCompensationPlaceholder(comp) && (!roleTrim || roleIsPlaceholder)) {
    return roles;
  }

  // Role name only (no compensation sent)
  if (!anyComp && roleTrim && !roleIsPlaceholder) {
    let idx = roles.findIndex((r) => roleNamesMatch(r.roleName, roleTrim));
    if (idx < 0) {
      const phIdx = roles.findIndex((r) => isSpcRolePlaceholderName(r.roleName));
      if (phIdx >= 0) {
        roles[phIdx] = { ...roles[phIdx], roleName: roleTrim };
      } else {
        roles.push({ roleName: roleTrim, ctc: {} });
      }
    }
    return dropPlaceholderRolesExcept(roles, roleTrim);
  }
  if (!anyComp) return roles;

  // Case 2 / 5: exact role name match → field-level merge
  const exactIdx = roleTrim
    ? roles.findIndex((r) => roleNamesMatch(r.roleName, roleTrim))
    : -1;
  if (exactIdx >= 0) {
    roles[exactIdx] = mergeIntoRole(roles[exactIdx], comp);
    if (!roleIsPlaceholder) {
      return dropPlaceholderRolesExcept(roles, roleTrim);
    }
    return roles;
  }

  const closeIdx = roles.findIndex(
    (r) => !isSpcRolePlaceholderName(r.roleName) && roleHasCloseCompensation(r, comp)
  );
  const phIdx = roles.findIndex((r) => isSpcRolePlaceholderName(r.roleName));

  // Case 3: TBD role + some real comp
  if (roleIsPlaceholder) {
    if (closeIdx >= 0) {
      roles[closeIdx] = mergeIntoRole(roles[closeIdx], comp);
      return roles;
    }
    if (phIdx >= 0) {
      if (roleHasCloseCompensation(roles[phIdx], comp) || !hasAnyCompensation(comp)) {
        roles[phIdx] = mergeIntoRole(roles[phIdx], comp, { roleName: "TBD" });
        return roles;
      }
      roles.push({
        roleName: "TBD",
        ctc: buildCtcFromComp(comp),
        ...(stipendToNumber(comp.stipendStr) !== undefined
          ? { internshipStipend: stipendToNumber(comp.stipendStr) }
          : {}),
      });
      return roles;
    }
    roles.push({
      roleName: "TBD",
      ctc: buildCtcFromComp(comp),
      ...(stipendToNumber(comp.stipendStr) !== undefined
        ? { internshipStipend: stipendToNumber(comp.stipendStr) }
        : {}),
    });
    return roles;
  }

  // Case 1 / 4: concrete new role
  if (closeIdx >= 0) {
    roles[closeIdx] = mergeIntoRole(roles[closeIdx], comp, {
      roleName: roleTrim || roles[closeIdx].roleName,
    });
    return dropPlaceholderRolesExcept(roles, roleTrim || roles[closeIdx].roleName);
  }

  if (phIdx >= 0) {
    if (roleHasCloseCompensation(roles[phIdx], comp) || allCompensationPlaceholder(comp)) {
      roles[phIdx] = mergeIntoRole(roles[phIdx], comp, { roleName: roleTrim });
      return dropPlaceholderRolesExcept(roles, roleTrim);
    }
    // Too far from TBD row → append (Case 1 far)
    roles.push(newRoleFromComp(roleTrim, comp));
    return dropPlaceholderRolesExcept(roles, roleTrim);
  }

  roles.push(newRoleFromComp(roleTrim, comp));
  return dropPlaceholderRolesExcept(roles, roleTrim);
}

/**
 * @param {{ ctcStr?: string, baseStr?: string, stipendStr?: string }} comp
 */
function buildCtcFromComp(comp) {
  /** @type {Record<string, string>} */
  const ctc = {};
  if (!isCompensationPlaceholder(comp.ctcStr)) ctc.CTC = String(comp.ctcStr).trim();
  if (!isCompensationPlaceholder(comp.baseStr)) ctc.Base = String(comp.baseStr).trim();
  return ctc;
}

/**
 * @param {string} roleName
 * @param {{ ctcStr?: string, baseStr?: string, stipendStr?: string }} comp
 */
function newRoleFromComp(roleName, comp) {
  const stipNum = stipendToNumber(comp.stipendStr);
  return {
    roleName: roleName || "TBD",
    ctc: buildCtcFromComp(comp),
    ...(stipNum !== undefined ? { internshipStipend: stipNum } : {}),
  };
}
