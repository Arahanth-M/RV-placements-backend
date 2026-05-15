import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import passport from "passport";
import helmet from "helmet";
import { connectDB } from "./config/db.js";
import { connectRedis } from "./src/utils/redisClient.js";
import { config, routes, messages } from "./config/constants.js";
import "./config/mongoCollections.js";
import {
  globalLimiter,
  authLimiter,
  adminLimiter,
  submissionLimiter,
  resumeLimiter,
} from "./middleware/rateLimiter.js";
import sanitizeInput from "./middleware/sanitizeInput.js";

import companyRouter from "./routes/companyRoutes.js";
import logoRouter from "./routes/logo.js";
import submissionRouter from "./routes/submissionsRoutes.js";
import experienceRouter from "./routes/experienceRoutes.js";
import authRouter from "./routes/authRoutes.js";
import adminRouter from "./routes/adminRoutes.js";
import eventRouter from "./routes/eventRoutes.js";
import yearStatsRouter from "./routes/yearStatsRoutes.js";
import notificationRouter from "./routes/notificationRoutes.js";
import studentRouter from "./routes/studentRoutes.js";
import placementRouter from "./routes/placementRoutes.js";
import leaderboardRouter from "./routes/leaderboardRoutes.js";
import interviewRouter from "./routes/interviewRoutes.js";
import resumeRouter from "./routes/resumeRoutes.js";

import "./services/passport.js";

dotenv.config();
const app = express();

// Trust proxy for rate limiting behind load balancers/proxies
app.set("trust proxy", 1);

const allowedOrigins = config.CORS_ORIGINS;

/**
 * 1. CORS Configuration
 * Applied early to ensure all cross-origin requests are handled first.
 */
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      console.log('🚫 CORS rejected origin:', origin);
      callback(new Error(messages.ERROR.CORS_ERROR));
    },
    credentials: true,
  })
);

/**
 * 2. Security Headers (Helmet)
 * Configured with a custom Content Security Policy (CSP) to allow external integrations 
 * like Voiceflow and Google profile images while maintaining high security.
 */
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
          "https://*.voiceflow.com"
        ],
        connectSrc: [
          "'self'", 
          "https://general-runtime.voiceflow.com",
          "https://*.voiceflow.com"
        ],
        imgSrc: [
          "'self'", 
          "data:", 
          "https://*.googleusercontent.com",
          "https://cdn.voiceflow.com",
          "https://*.voiceflow.com"
        ],
        frameSrc: ["'self'", "https://*.voiceflow.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
      },
    },
  })
);

/**
 * 3. Rate Limiting
 * Applied globally to prevent DoS, with route-specific overrides below.
 */
if (process.env.NODE_ENV !== "test") {
  app.use((req, res, next) => {
    // Temporarily bypass global throttling for AI interview load testing.
    if (req.path.startsWith("/api/interview")) {
      return next();
    }
    // Helpful-status batch is UI-polled and auth-protected; avoid tripping the
    // global limiter and surfacing it as a misleading browser "CORS" error.
    if (req.path === "/api/companies/helpful/status/batch") {
      return next();
    }
    return globalLimiter(req, res, next);
  });
}

app.use(express.json());
app.use(sanitizeInput);
app.use(cookieParser());
app.use(passport.initialize());

/**
 * 4. Route-Specific Rate Limiters
 */
if (process.env.NODE_ENV !== "test") {
  app.use(routes.AUTH, authLimiter);
  app.use(routes.ADMIN, adminLimiter);
  app.use(routes.SUBMISSIONS, submissionLimiter);
  app.use(routes.RESUME, resumeLimiter);
}

/**
 * 5. Application Routes
 */
app.use(routes.AUTH, authRouter);
app.use(routes.LOGO, logoRouter);
app.use(routes.SUBMISSIONS, submissionRouter);
app.use(routes.COMPANIES, companyRouter);
app.use(routes.EXPERIENCES, experienceRouter);
app.use(routes.ADMIN, adminRouter);
app.use(routes.EVENTS, eventRouter);
app.use(routes.YEAR_STATS, yearStatsRouter);
app.use(routes.NOTIFICATIONS, notificationRouter);
app.use(routes.STUDENTS, studentRouter);
app.use(routes.PLACEMENT, placementRouter);
app.use(routes.LEADERBOARD, leaderboardRouter);
app.use(routes.INTERVIEW, interviewRouter);
app.use(routes.RESUME, resumeRouter);

/**
 * 6. Server Initialization
 * Wrapped in NODE_ENV check to prevent port/connection conflicts during tests.
 */
if (process.env.NODE_ENV !== "test") {
  connectDB(config.MONGO_URI).then(async () => {
    await connectRedis().catch(() => {});
    const { startNotificationSseSubscriber } = await import(
      "./services/realtime/notificationEmitter.js"
    );
    await startNotificationSseSubscriber().catch((e) =>
      console.error("[notifications] SSE subscriber startup:", e?.message || e)
    );

    app.listen(config.PORT, () =>
      console.log(`🚀 Server running on ${config.BACKEND_URL}`)
    );

    const skipEmbeddedWorker = process.env.DISABLE_EMBEDDED_INTERVIEW_WORKER === "1";

    if (skipEmbeddedWorker) {
      console.log("[interview] Embedded BullMQ worker disabled.");
      return;
    }

    try {
      await import("./workers/interviewWorker.js");
      console.log("[interview] BullMQ interview worker started.");
    } catch (err) {
      console.error("[interview] Failed to start embedded worker:", err?.message || err);
    }
  });
}

// Export for Supertest
export default app;
