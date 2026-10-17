import { isPlatformOwnerEmail } from "../config/constants.js";
import { isActiveTestEmail } from "../services/testEmailService.js";

/** Shown for every rejected login while the platform is still being tested. */
export const PRODUCTION_LOGIN_MESSAGE = "Login through ur official college emailId";

/** Temporary lock on localhost and production. Automated tests stay open. */
export function productionLoginRestricted() {
  return process.env.NODE_ENV !== "test";
}

export function productionLoginAllowed(email) {
  if (!productionLoginRestricted()) return true;
  return isPlatformOwnerEmail(email);
}

/** Platform owners stay on the sync allowlist. Active test emails are checked in Mongo. */
export async function isProductionLoginAllowed(email) {
  if (productionLoginAllowed(email)) return true;
  return isActiveTestEmail(email);
}
