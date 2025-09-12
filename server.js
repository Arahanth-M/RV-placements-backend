
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

import companyRouter from "./routes/companyRoutes.js";
import userRouter from "./routes/user.js";
import experienceRouter from "./routes/experienceRoutes.js";
import headerRouter from "./routes/headerRoutes.js";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: ["http://localhost:5173", "http://51.21.171.150"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.use("/", companyRouter);
app.use("/", userRouter);
app.use("/api", experienceRouter); 
app.use("/auth",headerRouter);

const PORT = process.env.PORT;
const MONGO_URI = process.env.MONGODB_URL ;

connectDB(MONGO_URI).then(() => {
  app.listen(PORT, () =>
    console.log(`🚀 Server running on http://localhost:${PORT}`)
  );
});


