import { isPlatformOwnerEmail } from "../config/constants.js";

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
