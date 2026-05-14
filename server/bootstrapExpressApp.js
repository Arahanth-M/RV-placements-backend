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

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://cdn.voiceflow.com",
            "https://*.voiceflow.com",
          ],
          connectSrc: [
            "'self'",
            "https://general-runtime.voiceflow.com",
            "https://*.voiceflow.com",
          ],
          imgSrc: [
            "'self'",
            "data:",
            "https://*.googleusercontent.com",
            "https://cdn.voiceflow.com",
            "https://*.voiceflow.com",
          ],
          frameSrc: ["'self'", "https://*.voiceflow.com"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
        },
      },
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
      if (req.path === "/health") {
        return next();
      }
      return globalLimiter(req, res, next);
    });
  }

  app.use(express.json());
  app.use(sanitizeInput);
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
}

export function createExpressApp() {
  return express();
}
