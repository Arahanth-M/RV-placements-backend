/**
 * Drops the MongoDB collection used by express-session + connect-mongo (default name: "sessions").
 * Auth is JWT-only; this removes leftover session store data. Does not touch User or other app collections.
 *
 * Usage: MONGO_URI in .env (or env), then:
 *   npm run db:drop-sessions
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const EXPRESS_SESSION_COLLECTIONS = ["sessions"];

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const existing = new Set(
    (await db.listCollections().toArray()).map((c) => c.name)
  );

  for (const name of EXPRESS_SESSION_COLLECTIONS) {
    if (existing.has(name)) {
      await db.collection(name).drop();
      console.log(`Dropped collection: ${name}`);
    } else {
      console.log(`Collection "${name}" not found — skipped.`);
    }
  }

  await mongoose.connection.close();
  console.log("Finished. Auth remains stateless (JWT only; no session store in MongoDB).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
