import dotenv from "dotenv";
dotenv.config();

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
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
};

// API Routes
export const routes = {
  AUTH: '/api/auth',
  LOGO: '/api/logo',
  COMPANIES: '/api/companies',
  MISSING_COMPANIES: '/api/missing-companies',
  SUBMISSIONS: '/api/submissions',
  EXPERIENCES: '/api/experiences',
  PAYMENT: '/api/payment',
  LEETCODE: '/api/leetcode',
  ADMIN: '/api/admin',
  EVENTS: '/api/events',
  YEAR_STATS: '/api/year-stats',
  NOTIFICATIONS: '/api/notifications',
  STUDENTS: '/api/students',
  PLACEMENT: '/api/placement',
  LEADERBOARD: '/api/leaderboard',
  INTERVIEW: '/api/interview',
  RESUME: '/api/resume',
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

/** Single canonical allowlist / admin identity for dev defaults (override with env). */
export const DEFAULT_PLATFORM_OWNER_EMAIL = "arahanthm.cs22@rvce.edu.in";

// Login allowlist: this Google account may sign in (student flow and/or admin flow).
export const ALLOWED_LOGIN_EMAIL =
  process.env.ALLOWED_LOGIN_EMAIL || DEFAULT_PLATFORM_OWNER_EMAIL;

// Admin email: must match this address to complete /api/auth/google/admin OAuth (JWT gets isAdminSession).
// Student OAuth uses /api/auth/google — same email, but isAdminSession is false.
export const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL?.trim() || DEFAULT_PLATFORM_OWNER_EMAIL;

// Collection used to determine whether a student is in the active beta cohort.
export const BETA_ACCESS_COLLECTION =
  process.env.BETA_ACCESS_COLLECTION?.trim() || "users27_monday";

// Student placement profile (USN/email lookup, popup companies, /api/students/profile).
// Roster export name (case resolved at runtime when possible).
export const STUDENT_PROFILE_COLLECTION =
  process.env.STUDENT_PROFILE_COLLECTION?.trim() || "users27_monday";

// Email column name in the exported student roster collection.
export const STUDENT_EMAIL_FIELD =
  process.env.STUDENT_EMAIL_FIELD?.trim() || "Email Address";

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
