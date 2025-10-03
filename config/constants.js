import dotenv from "dotenv";
dotenv.config();

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
  MONGO_URI: process.env.MONGO_URI || process.env.MONGODB_URL || 'mongodb://localhost:27017/rv-placements',
  
  // OAuth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  
  // Session
  SESSION_SECRET: process.env.SESSION_SECRET || 'default-session-secret-change-in-production',
  SESSION_TOUCH_AFTER: parseInt(process.env.SESSION_TOUCH_AFTER) || 24 * 3600, // 24 hours
  SESSION_MAX_AGE: parseInt(process.env.SESSION_MAX_AGE) || 30 * 24 * 60 * 60 * 1000, // 30 days
  
  // CORS
  CORS_ORIGINS: process.env.CORS_ORIGINS ? 
    process.env.CORS_ORIGINS.split(',') : 
    ['http://localhost:5173', 'http://lastminuteplacementprep.in', 'https://lastminuteplacementprep.in'],
  
  // AWS (if needed)
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  BUCKET_NAME: process.env.BUCKET_NAME,
  
  // AI/ML
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL_NAME: process.env.AI_MODEL_NAME || 'gpt-3.5-turbo',
};

// Derived URLs
export const urls = {
  CLIENT_URL: config.NODE_ENV === 'production' 
    ? `https://${config.PRODUCTION_DOMAIN}` 
    : config.FRONTEND_URL,
  
  GOOGLE_CALLBACK_URL: config.NODE_ENV === 'production'
    ? `https://${config.PRODUCTION_DOMAIN}/api/auth/google/callback`
    : `${config.BACKEND_URL}/api/auth/google/callback`,
};

// API Routes
export const routes = {
  AUTH: '/api/auth',
  COMPANIES: '/api/companies',
  SUBMISSIONS: '/api/submissions',
  EXPERIENCES: '/api/experiences',
  CHAT: '/api/chat',
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

// Session Configuration
export const sessionConfig = {
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: config.SESSION_MAX_AGE,
  },
};

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
