/** Legacy and untagged content uses an empty key (shown as General in the UI). */
export const GENERAL_PREP_ROLE_KEY = "";

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * @param {unknown} role Free-text role from research jobs or admin input.
 * @returns {{ key: string, label: string }}
 */
export function normalizePrepRoleKey(role) {
  const label = compact(role);
  if (!label) {
    return { key: GENERAL_PREP_ROLE_KEY, label: "General" };
  }
  const key =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || GENERAL_PREP_ROLE_KEY;
  return { key, label };
}

/**
 * @param {unknown} prepRoleKey
 * @param {string} suffix
 */
export function prepRoleScopedKey(prepRoleKey, suffix) {
  return `${String(prepRoleKey ?? "")}\0${String(suffix || "")}`;
}

/**
 * @param {unknown[]} prepRoles
 * @param {{ key: string, label: string }} entry
 */
export function prepRoleCatalogMissing(prepRoles, entry) {
  const key = String(entry?.key ?? "");
  return !(Array.isArray(prepRoles) ? prepRoles : []).some(
    (row) => String(row?.key ?? "") === key
  );
}

/**
 * @param {unknown} prepRoleKey
 * @param {unknown[]} prepRoles
 */
export function prepRoleLabelForKey(prepRoleKey, prepRoles) {
  const key = String(prepRoleKey ?? "");
  if (!key) return "General";
  const hit = (Array.isArray(prepRoles) ? prepRoles : []).find(
    (row) => String(row?.key ?? "") === key
  );
  return compact(hit?.label) || key;
}
