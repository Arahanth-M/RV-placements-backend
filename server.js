import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import MongoStore from "connect-mongo";
import passport from "passport";
import { connectDB } from "./config/db.js";
import keys from "./config/keys.js";
import companyRouter from "./routes/companyRoutes.js";
import experienceRouter from "./routes/experienceRoutes.js";
import authRouter from "./routes/authRoutes.js";
import "./services/passport.js";



dotenv.config();
const app = express();


app.set("trust proxy", 1);
const allowedOrigins = [
  "http://localhost:5173", 
  "http://lastminuteplacementprep.in", 
  "https://lastminuteplacementprep.in",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(
  session({
    secret: keys.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: keys.mongoURI,
      touchAfter: 24 * 3600, 
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", 
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, 
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());
app.use("/api/auth", authRouter);
app.use("/api/companies", companyRouter);
app.use("/api/experiences", experienceRouter);

const PORT = process.env.PORT || 7779;
const MONGO_URI = process.env.MONGODB_URL;

connectDB(MONGO_URI).then(() => {
  app.listen(PORT, () =>
    console.log(`🚀 Server running on http://localhost:${PORT}`)
  );
});
