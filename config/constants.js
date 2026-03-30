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
  
  // JWT (set JWT_SECRET in env; used when signing tokens)
  JWT_SECRET: process.env.JWT_SECRET,

  // CORS
  CORS_ORIGINS: parseCorsOrigins(process.env.CORS_ORIGINS),
  
  // AWS (if needed)
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  BUCKET_NAME: process.env.BUCKET_NAME,
  
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
  COMPANIES: '/api/companies',
  SUBMISSIONS: '/api/submissions',
  EXPERIENCES: '/api/experiences',
  PAYMENT: '/api/payment',
  LEETCODE: '/api/leetcode',
  ADMIN: '/api/admin',
  EVENTS: '/api/events',
  YEAR_STATS: '/api/year-stats',
  COMMENTS: '/api',
  NOTIFICATIONS: '/api/notifications',
  STUDENTS: '/api/students',
  PLACEMENT: '/api/placement',
  LEADERBOARD: '/api/leaderboard',
  INTERVIEW: '/api/interview',
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

// Login allowlist (temporary): only this Google account may sign in as student or admin.
export const ALLOWED_LOGIN_EMAIL =
  process.env.ALLOWED_LOGIN_EMAIL || "arahanthm.cs22@rvce.edu.in";

// Admin Configuration (defaults to same as allowlist when unset)
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || ALLOWED_LOGIN_EMAIL;

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
