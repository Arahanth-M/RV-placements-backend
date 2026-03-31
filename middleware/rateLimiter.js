import rateLimit from "express-rate-limit";

/**
 * Global Rate Limiter: Applies to all incoming requests from a single IP.
 * Used to protect against general DoS attacks and low-level scraping.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Increased from 100: allow for rich SPA data fetching and multiple users
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again after 15 minutes",
});

/**
 * Auth Rate Limiter: Stricter limit for authentication routes.
 * Protects against brute-force attacks on OAuth callbacks and user checks.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Increased from 20: allow for frequent session/admin checks in the frontend
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many authentication attempts, please try again after 15 minutes",
  skipSuccessfulRequests: false, 
});

/**
 * Admin Rate Limiter: Protects critical administrative operations.
 */
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Increased from 50
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many administrative attempts, please try again after 15 minutes",
});

/**
 * Submission Rate Limiter: Specifically for POST routes where users submit data.
 */
export const submissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Increased from 30
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many submission attempts, please try again later",
});

/**
 * AI Interview Start Limiter: Very strict limit on starting new AI interview sessions.
 */
export const aiStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 sessions per 15 minutes
  message: "Too many interview sessions started. Please try again later.",
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * AI Interview Answer Limiter: Limit on answer submissions to prevent AI cost/load spikes.
 */
export const aiAnswerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 answers per 15 minutes
  message: "Too many responses submitted. Please slow down.",
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});
