import dotenv from "dotenv";
dotenv.config();

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:7778",
  "http://localhost:7777",
  "http://localhost:7779",
  "http://lastminuteplacementprep.in",
  "https://lastminuteplacementprep.in",
  "http://www.lastminuteplacementprep.in",
  "https://www.lastminuteplacementprep.in",
];

const parseCorsOrigins = (origins) => {
  if (!origins) {
    return DEFAULT_CORS_ORIGINS;
  }

  const envOrigins = origins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set([...DEFAULT_CORS_ORIGINS, ...envOrigins])];
};

// Environment configuration
export const config = {
  // Server
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 7779,
  
  // URLs
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:7779',
  PRODUCTION_DOMAIN: process.env.PRODUCTION_DOMAIN || 'lastminuteplacementprep.in',
  
  // Database
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/rv-placements',
  
  // OAuth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,

  // External form redirect
  PLACEMENT_FORM_URL:
    process.env.PLACEMENT_FORM_URL ||
    "https://docs.google.com/forms/d/e/1FAIpQLScRXllJ4WmuiIPicffKS4y3amX-6gjOMu31yGMu4XZeKaMukg/viewform?usp=dialog",
  
  // JWT (set JWT_SECRET in env; used when signing tokens)
  JWT_SECRET: process.env.JWT_SECRET,

  // CORS
  CORS_ORIGINS: parseCorsOrigins(process.env.CORS_ORIGINS),
};

// Derived URLs
export const urls = {
  CLIENT_URL: config.NODE_ENV === 'production' 
    ? `https://${config.PRODUCTION_DOMAIN}` 
    : config.FRONTEND_URL,
  GOOGLE_CALLBACK_PATH: "/api/auth/google/callback",
  /** SPA route after Google. Google Console URI stays GOOGLE_CALLBACK_PATH. */
  FRONTEND_AUTH_CALLBACK_PATH: "/rvce/auth/callback",
};

// API Routes
export const routes = {
  AUTH: '/api/auth',
  LOGO: '/api/logo',
  COMPANIES: '/api/companies',
  SUBMISSIONS: '/api/submissions',
  EXPERIENCES: '/api/experiences',
  ADMIN: '/api/admin',
  EVENTS: '/api/events',
  YEAR_STATS: '/api/year-stats',
  NOTIFICATIONS: '/api/notifications',
  STUDENTS: '/api/students',
  PLACEMENT: '/api/placement',
  PLACEMENT_STATS: '/api/placement-stats',
  LEADERBOARD: '/api/leaderboard',
  INTERVIEW: '/api/interview',
  INTERVIEW_QUESTION_BANK: '/api/interview-question-bank',
  PRACTICE_CHALLENGES: '/api/practice-challenges',
  DRIVE_CALENDAR: '/api/drive-calendar',
  RESUME: '/api/resume',
  PREP_PATH: '/api/prep-path',
  DAU: '/api/dau',
  BILLING: '/api/billing',
};

// Messages
export const messages = {
  SUCCESS: {
    COMPANY_SUBMITTED: 'Company submitted for review!',
    SUBMISSION_RECEIVED: 'Submission received and pending placement.',
    LOGIN_SUCCESS: 'Login successful',
  },
  ERROR: {
    NOT_AUTHENTICATED: 'Not authenticated',
    LOGOUT_FAILED: 'Logout failed',
    MISSING_FIELDS: 'Missing required fields',
    SAVE_ERROR: 'Error saving submission',
    CORS_ERROR: 'Not allowed by CORS',
  },
  VALIDATION: {
    COMPANY_NAME_REGEX: /^[a-zA-Z0-9\s]{2,50}$/,
    POSITIVE_INTEGER_REGEX: /^\d+$/,
  },
};

export const ADMIN_SCOPE_PLATFORM = "platform";
export const ADMIN_SCOPE_CAMPUS = "campus";

// Optional extra login allowlist entry (not required for platform/campus admins).
export const ALLOWED_LOGIN_EMAIL = process.env.ALLOWED_LOGIN_EMAIL || "";

function parseEmailList(raw) {
  return [
    ...new Set(
      String(raw || "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

/**
 * Platform owners (`/general` admin). Separate people from campus admins.
 * Set PLATFORM_OWNER_EMAILS in .env (comma-separated). Empty if unset.
 */
export const PLATFORM_OWNER_EMAILS = parseEmailList(
  process.env.PLATFORM_OWNER_EMAILS
);

/**
 * Campus dashboard admins (`/rvce` and later tenants).
 * Set ADMIN_EMAILS (comma-separated) or legacy ADMIN_EMAIL (single).
 * Example: ADMIN_EMAILS=one@example.com,two@example.com
 */
export const ADMIN_EMAILS = parseEmailList(
  process.env.ADMIN_EMAILS?.trim() || process.env.ADMIN_EMAIL?.trim()
);

/** @deprecated Prefer ADMIN_EMAILS; first entry for backward-compatible imports. */
export const ADMIN_EMAIL = ADMIN_EMAILS[0] || "";

export function isPlatformOwnerEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return normalized.length > 0 && PLATFORM_OWNER_EMAILS.includes(normalized);
}

export function isCampusAdminEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return normalized.length > 0 && ADMIN_EMAILS.includes(normalized);
}

/** True when the email may complete an admin Google login (platform or campus). */
export function isAdminEmail(email) {
  return isPlatformOwnerEmail(email) || isCampusAdminEmail(email);
}

/**
 * @param {unknown} email
 * @returns {{ adminScope: "platform"|"campus", isSuperAdmin: boolean }|null}
 */
export function adminIdentityFromEmail(email) {
  if (isPlatformOwnerEmail(email)) {
    return { adminScope: ADMIN_SCOPE_PLATFORM, isSuperAdmin: true };
  }
  if (isCampusAdminEmail(email)) {
    return { adminScope: ADMIN_SCOPE_CAMPUS, isSuperAdmin: false };
  }
  return null;
}

// Default values
export const defaults = {
  PAGINATION: {
    LIMIT: 10,
    OFFSET: 0,
  },
  FILE_UPLOAD: {
    MAX_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_TYPES: ['image/jpeg', 'image/png', 'application/pdf'],
  },
};
