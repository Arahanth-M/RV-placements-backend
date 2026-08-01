import mongoose from "mongoose";

export async function connectDB(uri) {
  try {
    const dbName = String(process.env.MONGODB_DB_NAME || "").trim();
    await mongoose.connect(uri, dbName ? { dbName } : undefined);
    const resolved =
      mongoose.connection?.db?.databaseName || dbName || "(default)";
    console.log(`✅ MongoDB connected [${resolved}]`);
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  }
}
