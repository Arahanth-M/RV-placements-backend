/**
 * Shared Express middleware for split entry points (server-main.js, server-interview.js).
 * Keeps CORS / Helmet / body parsing aligned with server.js without modifying server.js.
 */
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import passport from "passport";
import helmet from "helmet";
import { config, messages, routes } from "../config/constants.js";
import {
  globalLimiter,
  authLimiter,
  adminLimiter,
  submissionLimiter,
  resumeLimiter,
  prepPathLimiter,
} from "../middleware/rateLimiter.js";
import sanitizeInput from "../middleware/sanitizeInput.js";
dotenv.config();

import "../services/passport.js";

/**
 * @param {import("express").Express} app
 * @param {{ bypassGlobalLimiterForInterviewPrefix?: boolean }} [options]
 */
export function applySharedHttpMiddleware(app, options = {}) {
  const bypassInterview = options.bypassGlobalLimiterForInterviewPrefix === true;

  app.set("trust proxy", 1);

  const allowedOrigins = config.CORS_ORIGINS;

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        console.log("🚫 CORS rejected origin:", origin);
        callback(new Error(messages.ERROR.CORS_ERROR));
      },
      credentials: true,
    })
  );

  const isProduction = process.env.NODE_ENV === "production";

  app.use(
    helmet({
      // HSTS on http://localhost breaks split local dev (browser upgrades :7778 → https → ERR_NETWORK).
      strictTransportSecurity: isProduction,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdn.voiceflow.com",
                "https://*.voiceflow.com",
                "https://checkout.razorpay.com",
              ],
              connectSrc: [
                "'self'",
                "https://general-runtime.voiceflow.com",
                "https://*.voiceflow.com",
                "https://api.razorpay.com",
                "https://lumberjack.razorpay.com",
              ],
              imgSrc: [
                "'self'",
                "data:",
                "https://*.googleusercontent.com",
                "https://cdn.voiceflow.com",
                "https://*.voiceflow.com",
              ],
              frameSrc: ["'self'", "https://*.voiceflow.com", "https://api.razorpay.com", "https://checkout.razorpay.com"],
              styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              fontSrc: ["'self'", "https://fonts.gstatic.com"],
            },
          }
        : false,
    })
  );

  if (process.env.NODE_ENV !== "test") {
    app.use((req, res, next) => {
      if (bypassInterview && req.path.startsWith("/api/interview")) {
        return next();
      }
      if (req.path === "/api/companies/helpful/status/batch") {
        return next();
      }
      if (req.path === "/api/dau/heartbeat") {
        return next();
      }
      if (req.path === "/health") {
        return next();
      }
      if (req.path === "/api/billing/webhook") {
        return next();
      }
      return globalLimiter(req, res, next);
    });
  }

  app.use((req, res, next) => {
    const path = String(req.originalUrl || req.url || "").split("?")[0];
    if (path === "/api/billing/webhook") {
      return express.raw({ type: "application/json" })(req, res, next);
    }
    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    // Never run the JSON parser on multipart uploads (avoids body-parser 500s).
    if (contentType.includes("multipart/form-data")) {
      return next();
    }
    // Prep CSV preview sends full file contents as JSON text.
    return express.json({ limit: "10mb" })(req, res, next);
  });
  // body-parser SyntaxError / entity.too.large → JSON 400 instead of HTML 500
  app.use((err, req, res, next) => {
    if (!err) return next();
    if (err.type === "entity.too.large" || err.status === 413) {
      return res.status(413).json({ error: "Request body too large." });
    }
    if (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400)) {
      return res.status(400).json({ error: "Invalid JSON body." });
    }
    return next(err);
  });
  app.use((req, res, next) => {
    const path = String(req.originalUrl || req.url || "").split("?")[0];
    if (path === "/api/billing/webhook") return next();
    return sanitizeInput(req, res, next);
  });
  app.use(cookieParser());
  app.use(passport.initialize());
}

/** Rate limiters for routes mounted on backend-main (matches server.js subset). */
export function attachMainRouteRateLimiters(app) {
  if (process.env.NODE_ENV === "test") return;
  app.use(routes.AUTH, authLimiter);
  app.use(routes.ADMIN, adminLimiter);
  app.use(routes.SUBMISSIONS, submissionLimiter);
  app.use(routes.RESUME, resumeLimiter);
  app.use(routes.PREP_PATH, prepPathLimiter);
}

export function createExpressApp() {
  return express();
}
