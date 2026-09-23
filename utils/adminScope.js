import { ADMIN_SCOPE_PLATFORM } from "../config/constants.js";

/**
 * JWT / request user is a platform owner (super admin).
 * @param {{ isAdminSession?: unknown, isSuperAdmin?: unknown, adminScope?: unknown }|null|undefined} user
 */
export function isPlatformAdminUser(user) {
  if (!user || user.isAdminSession !== true) return false;
  if (user.isSuperAdmin === true) return true;
  return String(user.adminScope || "").trim().toLowerCase() === ADMIN_SCOPE_PLATFORM;
}

/**
 * JWT / request user is any admin session (campus or platform).
 * @param {{ isAdminSession?: unknown }|null|undefined} user
 */
export function isAdminSessionUser(user) {
  return user?.isAdminSession === true;
}
