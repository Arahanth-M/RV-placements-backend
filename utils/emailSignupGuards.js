import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOCKLIST_PATH = path.join(
  __dirname,
  "..",
  "data",
  "disposable_email_blocklist.conf"
);

/** @type {Set<string>|null} */
let disposableDomains = null;

function parseBlocklist(raw) {
  const domains = new Set();
  for (const line of String(raw || "").split(/\r?\n/)) {
    const domain = line.trim().toLowerCase();
    if (!domain || domain.startsWith("#")) continue;
    domains.add(domain);
  }
  return domains;
}

function loadDisposableDomains() {
  if (disposableDomains) return disposableDomains;
  try {
    const raw = fs.readFileSync(BLOCKLIST_PATH, "utf8");
    disposableDomains = parseBlocklist(raw);
  } catch (err) {
    console.error(
      "[email-signup-guards] failed to load disposable blocklist",
      err?.message || err
    );
    disposableDomains = new Set();
  }

  // Optional ops override: EXTRA_DISPOSABLE_EMAIL_DOMAINS=foo.com,bar.net
  const extra = String(process.env.EXTRA_DISPOSABLE_EMAIL_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  for (const domain of extra) {
    disposableDomains.add(domain);
  }

  return disposableDomains;
}

/** Test helper — reset cached Set so env overrides can be reapplied. */
export function resetDisposableDomainCacheForTests() {
  disposableDomains = null;
}

export function emailDomainFromAddress(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 0 || at === normalized.length - 1) return "";
  return normalized.slice(at + 1);
}

/**
 * True when the address uses a known disposable / temporary mail domain
 * (exact match or parent domain, e.g. foo.mailinator.com).
 */
export function isDisposableEmail(email) {
  const domain = emailDomainFromAddress(email);
  if (!domain) return false;

  const blocked = loadDisposableDomains();
  if (blocked.has(domain)) return true;

  const parts = domain.split(".");
  // Require at least domain.tld remaining after stripping left labels.
  for (let i = 1; i <= parts.length - 2; i += 1) {
    const parent = parts.slice(i).join(".");
    if (blocked.has(parent)) return true;
  }
  return false;
}

/**
 * Google OAuth profile email verification flag.
 * passport-google-oauth20 may expose boolean or string "true".
 */
export function isGoogleEmailVerified(profile) {
  const fromEmails = profile?.emails?.[0]?.verified;
  if (fromEmails === true || fromEmails === "true") return true;

  const fromJson = profile?._json?.email_verified;
  if (fromJson === true || fromJson === "true") return true;

  return false;
}
