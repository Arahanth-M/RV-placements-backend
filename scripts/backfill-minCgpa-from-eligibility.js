/**
 * Backfill `company_visits.minCgpa` from free-text `eligibility`.
 *
 * Usage (from RV-placements-backend):
 *   node scripts/backfill-minCgpa-from-eligibility.js
 *   node scripts/backfill-minCgpa-from-eligibility.js --dry-run
 *
 * Requires: MONGO_URI in .env
 */

import { existsSync, readFileSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { minCgpaFromEligibilityText } from "../utils/extractMinCgpa.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFromFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFromFile(path.join(__dirname, "../.env"));

const TARGET_VISITS = "company_visits";
const DRY_RUN = process.argv.includes("--dry-run");

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("Missing MONGO_URI in environment (set in .env).");
    process.exit(1);
  }

  if (DRY_RUN) {
    log("MODE: DRY-RUN (no writes)");
  }

  await mongoose.connect(MONGO_URI);
  const col = mongoose.connection.db.collection(TARGET_VISITS);

  const cursor = col.find(
    {
      eligibility: { $exists: true, $type: "string", $ne: "" },
    },
    { projection: { _id: 1, eligibility: 1, minCgpa: 1, name: 1 } }
  );

  let scanned = 0;
  let wouldUpdate = 0;
  let updated = 0;
  let parsed = 0;
  let cleared = 0;

  for await (const row of cursor) {
    scanned += 1;
    const next = minCgpaFromEligibilityText(row.eligibility);
    const prev =
      row.minCgpa == null || row.minCgpa === ""
        ? null
        : Number(row.minCgpa);
    const prevNorm = Number.isFinite(prev) ? prev : null;

    if (next === prevNorm) continue;

    wouldUpdate += 1;
    if (next != null) parsed += 1;
    else cleared += 1;

    if (DRY_RUN) {
      if (wouldUpdate <= 20) {
        log("sample", {
          id: String(row._id),
          eligibility: String(row.eligibility).slice(0, 80),
          prev: prevNorm,
          next,
        });
      }
      continue;
    }

    await col.updateOne({ _id: row._id }, { $set: { minCgpa: next } });
    updated += 1;
  }

  log("done", { scanned, wouldUpdate, updated, parsed, cleared, dryRun: DRY_RUN });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
