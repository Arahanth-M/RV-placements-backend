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
import chatRouter from "./routes/chatRoutes.js";

import "./services/passport.js";




dotenv.config();
const app = express();


app.set("trust proxy", 1);
const allowedOrigins = config.CORS_ORIGINS;

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(messages.ERROR.CORS_ERROR));
      }
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
app.use(routes.CHAT, chatRouter);

connectDB(config.MONGO_URI).then(() => {
  app.listen(config.PORT, () =>
    console.log(`🚀 Server running on ${config.BACKEND_URL}`)
  );
});

// Export app for testing
export default app;
