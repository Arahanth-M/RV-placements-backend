/**
 * Phase 2 — backend-interview: /api/interview only. Default local port 7777.
 * Legacy monolith remains at server.js.
 */
import "./config/mongoCollections.js";
import { connectDB } from "./config/db.js";
import { connectRedis } from "./src/utils/redisClient.js";
import { config, routes } from "./config/constants.js";
import { createExpressApp, applySharedHttpMiddleware } from "./server/bootstrapExpressApp.js";

import interviewRouter from "./routes/interviewRoutes.js";
import { createHealthHandler } from "./server/healthHandler.js";

const app = createExpressApp();
applySharedHttpMiddleware(app, { bypassGlobalLimiterForInterviewPrefix: true });

app.get("/health", createHealthHandler("backend-interview"));

app.use(routes.INTERVIEW, interviewRouter);

if (process.env.NODE_ENV !== "test") {
  connectDB(config.MONGO_URI).then(async () => {
    await connectRedis().catch(() => {});

    const port = Number(process.env.PORT || 7777);
    app.listen(port, () => {
      console.log(`[backend-interview] listening on port ${port}`);
    });
  });
}

export default app;
