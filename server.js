// import express from "express";
// import cors from "cors";
// import dotenv from "dotenv";
// import session from "express-session";
// import MongoStore from "connect-mongo";
// import passport from "passport";
// import { connectDB } from "./config/db.js";
// import keys from "./config/keys.js";

// // Import routes
// import companyRouter from "./routes/companyRoutes.js";
// import experienceRouter from "./routes/experienceRoutes.js";
// import authRouter from "./routes/authRoutes.js";

// // Import passport configuration
// import "./services/passport.js";

// dotenv.config();

// const app = express();

// // ✅ CORS should come BEFORE session and routes
// app.use(cors({
//   origin: "http://localhost:5173",  // React frontend
//   credentials: true,                // allow cookies
// }));

// app.use(express.json());


// app.use(session({
//   secret: keys.sessionSecret,
//   resave: false,
//   saveUninitialized: false,
//   store: MongoStore.create({
//     mongoUrl: keys.mongoURI,
//     touchAfter: 24 * 3600, // lazy update once/day
//   }),
//   cookie: {
//     httpOnly: true,
//     secure: false,           // set to true in production with HTTPS
//     sameSite: "lax",         // allow OAuth redirect to send cookie
//     maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
//   },
// }));

// // ✅ Passport middleware AFTER session
// app.use(passport.initialize());
// app.use(passport.session());

// // Routes
// app.use("/auth", authRouter);
// app.use("/", companyRouter);
// app.use("/api", experienceRouter);

// const PORT = process.env.PORT || 5000;
// const MONGO_URI = process.env.MONGODB_URL;

// connectDB(MONGO_URI).then(() => {
//   app.listen(PORT, () =>
//     console.log(`🚀 Server running on http://localhost:${PORT}`)
//   );
// });

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import MongoStore from "connect-mongo";
import passport from "passport";
import { connectDB } from "./config/db.js";
import keys from "./config/keys.js";

// Import routes
import companyRouter from "./routes/companyRoutes.js";
import experienceRouter from "./routes/experienceRoutes.js";
import authRouter from "./routes/authRoutes.js";

// Import passport configuration
import "./services/passport.js";

dotenv.config();

const app = express();

// ✅ Allowed origins
const allowedOrigins = [
  "http://localhost:5173",             // local React dev
  "http://lastMinutePlacementPrep.in"  // production domain (http since no SSL)
];

// ✅ CORS should come BEFORE session and routes
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true, // allow cookies/sessions
}));

app.use(express.json());

app.use(session({
  secret: keys.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: keys.mongoURI,
    touchAfter: 24 * 3600, // lazy update once/day
  }),
  cookie: {
    httpOnly: true,
    secure: false,  // ✅ must be false for HTTP
    sameSite: "lax", // ✅ safe default for http
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

// ✅ Passport middleware AFTER session
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use("/api/auth", authRouter);
app.use("/api/companies", companyRouter);
app.use("/api/experience", experienceRouter);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGODB_URL;

connectDB(MONGO_URI).then(() => {
  app.listen(PORT, () =>
    console.log(`🚀 Server running on http://localhost:${PORT}`)
  );
});


