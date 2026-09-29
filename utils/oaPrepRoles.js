function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** Allowed OA research roles (fixed keys for platform prep). */
export const OA_PREP_ROLES = Object.freeze([
  { key: "sde", label: "SDE" },
  { key: "analyst", label: "Analyst" },
  { key: "data-scientist", label: "Data Scientist" },
]);

/**
 * @param {unknown} role
 * @returns {{ key: string, label: string }}
 */
export function resolveOaPrepRole(role) {
  const raw = compact(role);
  if (!raw) {
    const err = new Error("OA research failed: role is required (SDE, Analyst, or Data Scientist).");
    err.code = "invalid_input";
    throw err;
  }
  const lower = raw.toLowerCase();
  for (const entry of OA_PREP_ROLES) {
    if (entry.key === lower || entry.label.toLowerCase() === lower) {
      return { key: entry.key, label: entry.label };
    }
  }
  if (lower === "software engineer" || lower === "sde") {
    return OA_PREP_ROLES[0];
  }
  const err = new Error(
    "OA research failed: role must be SDE, Analyst, or Data Scientist."
  );
  err.code = "invalid_input";
  throw err;
}

/**
 * @param {unknown} role
 * @returns {boolean}
 */
export function isValidOaResearchRole(role) {
  try {
    resolveOaPrepRole(role);
    return true;
  } catch {
    return false;
  }
}
