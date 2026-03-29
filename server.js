import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import passport from "passport";
import { connectDB } from "./config/db.js";
import { connectRedis } from "./src/utils/redisClient.js";
import { config, routes, messages } from "./config/constants.js";
import companyRouter from "./routes/companyRoutes.js";
import experienceRouter from "./routes/experienceRoutes.js";
import authRouter from "./routes/authRoutes.js";
import submissionRoutes from "./routes/submissionsRoutes.js";
// PAYMENT GATEWAY INTEGRATION - COMMENTED OUT
import paymentRouter from "./routes/payment.js";
import leetcodeRouter from "./routes/leetcodeRoutes.js";
import adminRouter from "./routes/adminRoutes.js";
import eventRouter from "./routes/eventRoutes.js";
import yearStatsRouter from "./routes/yearStatsRoutes.js";
import commentRouter from "./routes/commentRoutes.js";
import notificationRouter from "./routes/notificationRoutes.js";
import studentRouter from "./routes/studentRoutes.js";
import placementRouter from "./routes/placementRoutes.js";
import leaderboardRouter from "./routes/leaderboardRoutes.js";
import interviewRouter from "./routes/interviewRoutes.js";

import "./services/passport.js";




dotenv.config();
const app = express();


app.set("trust proxy", 1);
const allowedOrigins = config.CORS_ORIGINS;

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        return callback(null, true);
      }
      
      // Check if origin is in allowed list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      // Log the rejected origin for debugging
      console.log('🚫 CORS rejected origin:', origin);
      console.log('✅ Allowed origins:', allowedOrigins);
      
      callback(new Error(messages.ERROR.CORS_ERROR));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

app.use(passport.initialize());
app.use(routes.AUTH, authRouter);
app.use(routes.COMPANIES, companyRouter);
app.use(routes.EXPERIENCES, experienceRouter);
app.use(routes.SUBMISSIONS, submissionRoutes);
// PAYMENT GATEWAY INTEGRATION - COMMENTED OUT
// app.use(routes.PAYMENT, paymentRouter);
app.use(routes.PAYMENT, paymentRouter); // Router exists but all routes are commented out
app.use(routes.LEETCODE, leetcodeRouter);
app.use(routes.ADMIN, adminRouter);
app.use(routes.EVENTS, eventRouter);
app.use(routes.YEAR_STATS, yearStatsRouter);
app.use(routes.COMMENTS, commentRouter);
app.use(routes.NOTIFICATIONS, notificationRouter);
app.use(routes.STUDENTS, studentRouter);
app.use(routes.PLACEMENT, placementRouter);
app.use(routes.LEADERBOARD, leaderboardRouter);
app.use(routes.INTERVIEW, interviewRouter);

connectDB(config.MONGO_URI).then(async () => {
  // Do not await Redis — if REDIS_URL is wrong or Redis is down, connect() can hang
  // and block app.listen(), breaking OAuth and all routes. Cache uses fault-tolerant helpers.
  connectRedis().catch(() => {});
  app.listen(config.PORT, () =>
    console.log(`🚀 Server running on ${config.BACKEND_URL}`)
  );

  const skipEmbeddedWorker =
    process.env.NODE_ENV === "test" ||
    process.env.DISABLE_EMBEDDED_INTERVIEW_WORKER === "1";

  if (skipEmbeddedWorker) {
    if (process.env.DISABLE_EMBEDDED_INTERVIEW_WORKER === "1") {
      console.log(
        "[interview] Embedded BullMQ worker disabled. Run `npm run worker:interview` (same REDIS_URL) or a dedicated worker container."
      );
    }
    return;
  }

  try {
    await import("./workers/interviewWorker.js");
    console.log("[interview] BullMQ interview worker started in-process (same Node as API).");
  } catch (err) {
    console.error(
      "[interview] Failed to start embedded interview worker — AI submit will queue jobs but they will not run:",
      err?.message || err
    );
  }
});

// Export app for testing
export default app;
