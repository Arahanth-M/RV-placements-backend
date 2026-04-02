import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const rateLimitExceededHandler = (req, res) => {
  console.warn("Rate limit exceeded", {
    userId: req.user?.id,
    ip: ipKeyGenerator(req),
  });

  return res.status(429).json({
    success: false,
    message: "Too many requests",
  });
};

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
  handler: rateLimitExceededHandler,
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
  handler: rateLimitExceededHandler,
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
  handler: rateLimitExceededHandler,
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
  handler: rateLimitExceededHandler,
});

/**
 * AI Interview Start Limiter: Very strict limit on starting new AI interview sessions.
 */
export const aiStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 sessions per 15 minutes
  message: "Too many interview sessions started. Please try again later.",
  keyGenerator: (req) => {
    if (req.user?.id) return req.user.id;
    if (req.user?.userId) return req.user.userId;
    if (req.user?._id) return String(req.user._id);
    return ipKeyGenerator(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitExceededHandler,
});

/**
 * AI Interview Answer Limiter: Limit on answer submissions to prevent AI cost/load spikes.
 */
export const aiAnswerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 answers per 15 minutes
  message: "Too many responses submitted. Please slow down.",
  keyGenerator: (req) => {
    if (req.user?.id) return req.user.id;
    if (req.user?.userId) return req.user.userId;
    if (req.user?._id) return String(req.user._id);
    return ipKeyGenerator(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitExceededHandler,
});
