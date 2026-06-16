/**
 * Phase 2 — backend-main: main REST API (no /api/interview). Default local port 7778.
 * Legacy monolith remains at server.js on port 7779.
 */
import "./config/mongoCollections.js";
import { connectDB } from "./config/db.js";
import { connectRedis } from "./src/utils/redisClient.js";
import { config, routes } from "./config/constants.js";
import {
  createExpressApp,
  applySharedHttpMiddleware,
  attachMainRouteRateLimiters,
} from "./server/bootstrapExpressApp.js";

import authRouter from "./routes/authRoutes.js";
import submissionRouter from "./routes/submissionsRoutes.js";
import companyRouter from "./routes/companyRoutes.js";
import adminRouter from "./routes/adminRoutes.js";
import eventRouter from "./routes/eventRoutes.js";
import yearStatsRouter from "./routes/yearStatsRoutes.js";
import placementGeneralStatsRouter from "./routes/placementGeneralStatsRoutes.js";
import notificationRouter from "./routes/notificationRoutes.js";
import studentRouter from "./routes/studentRoutes.js";
import placementRouter from "./routes/placementRoutes.js";
import leaderboardRouter from "./routes/leaderboardRoutes.js";
import resumeRouter from "./routes/resumeRoutes.js";
import logoRouter from "./routes/logo.js";
import experienceRouter from "./routes/experienceRoutes.js";
import { createHealthHandler } from "./server/healthHandler.js";

const app = createExpressApp();
applySharedHttpMiddleware(app, { bypassGlobalLimiterForInterviewPrefix: false });
attachMainRouteRateLimiters(app);

app.get("/health", createHealthHandler("backend-main"));

app.use(routes.AUTH, authRouter);
app.use(routes.LOGO, logoRouter);
app.use(routes.SUBMISSIONS, submissionRouter);
app.use(routes.COMPANIES, companyRouter);
app.use(routes.EXPERIENCES, experienceRouter);
app.use(routes.ADMIN, adminRouter);
app.use(routes.EVENTS, eventRouter);
app.use(routes.YEAR_STATS, yearStatsRouter);
app.use(routes.PLACEMENT_STATS, placementGeneralStatsRouter);
app.use(routes.NOTIFICATIONS, notificationRouter);
app.use(routes.STUDENTS, studentRouter);
app.use(routes.PLACEMENT, placementRouter);
app.use(routes.LEADERBOARD, leaderboardRouter);
app.use(routes.RESUME, resumeRouter);

if (process.env.NODE_ENV !== "test") {
  connectDB(config.MONGO_URI).then(async () => {
    await connectRedis().catch(() => {});
    const { startNotificationSseSubscriber } = await import(
      "./services/realtime/notificationEmitter.js"
    );
    await startNotificationSseSubscriber().catch((e) =>
      console.error("[notifications] SSE subscriber startup:", e?.message || e)
    );

    const port = Number(process.env.PORT || 7778);
    app.listen(port, () => {
      console.log(`[backend-main] listening on port ${port}`);
    });
  });
}

export default app;
