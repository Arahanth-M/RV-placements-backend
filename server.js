import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import MongoStore from "connect-mongo";
import passport from "passport";
import { connectDB } from "./config/db.js";
import keys from "./config/keys.js";
import { config, urls, routes, messages, sessionConfig } from "./config/constants.js";
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
app.use(
  session({
    ...sessionConfig,
    store: MongoStore.create({
      mongoUrl: config.MONGO_URI,
      touchAfter: config.SESSION_TOUCH_AFTER, 
    }),
  })
);

app.use(passport.initialize());
app.use(passport.session());
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

connectDB(config.MONGO_URI).then(() => {
  app.listen(config.PORT, () =>
    console.log(`🚀 Server running on ${config.BACKEND_URL}`)
  );
});

// Export app for testing
export default app;
