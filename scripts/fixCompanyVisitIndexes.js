/**
 * Fixes E11000 duplicate key on company_visits when the DB still has the legacy
 * unique index { companyId: 1, year: 1 } after the app moved to
 * { companyId: 1, year: 1, type: 1, cluster: 1 }.
 *
 * Usage (from RV-placements-backend): node scripts/fixCompanyVisitIndexes.js
 * Requires MONGO_URI in .env
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

const COLLECTION = "company_visits";
const LEGACY_UNIQUE_INDEX = "companyId_1_year_1";
const COMPOUND_UNIQUE_INDEX = "companyId_1_year_1_type_1_cluster_1";

async function main() {
  const uri = process.env.MONGO_URI?.trim();
  if (!uri) {
    console.error("MONGO_URI is not set (.env next to scripts/).");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const col = mongoose.connection.db.collection(COLLECTION);

  console.log("Indexes before:");
  for (const idx of await col.indexes()) {
    console.log(`  - ${idx.name}`, idx.key);
  }

  const backfillType = await col.updateMany(
    { type: { $exists: false } },
    { $set: { type: "" } }
  );
  const backfillCluster = await col.updateMany(
    { cluster: { $exists: false } },
    { $set: { cluster: "" } }
  );
  console.log(
    `Backfill missing type/cluster: matched ${backfillType.matchedCount} / ${backfillCluster.matchedCount} docs`
  );

  try {
    await col.dropIndex(LEGACY_UNIQUE_INDEX);
    console.log(`Dropped legacy unique index: ${LEGACY_UNIQUE_INDEX}`);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/index not found|ns not found/i.test(msg)) {
      console.log(`Legacy index ${LEGACY_UNIQUE_INDEX} not present (ok)`);
    } else {
      throw e;
    }
  }

  await col.createIndex(
    { companyId: 1, year: 1, type: 1, cluster: 1 },
    { unique: true, name: COMPOUND_UNIQUE_INDEX }
  );
  console.log(`Ensured compound unique index: ${COMPOUND_UNIQUE_INDEX}`);

  console.log("Indexes after:");
  for (const idx of await col.indexes()) {
    console.log(`  - ${idx.name}`, idx.key);
  }

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
