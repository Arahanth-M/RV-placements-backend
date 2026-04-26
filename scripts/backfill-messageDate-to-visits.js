/**
 * One-off backfill: copy `messageDate` from `companies1_copy` → `company_visits` only.
 *
 * Rules:
 * - READ ONLY from collection `companies1_copy` (never `companies1` production)
 * - WRITE ONLY `company_visits.messageDate` (no other fields)
 * - Match via `sourceCopyId` on visit = original `companies1_copy._id`
 * - Skip if visit already has a non-null `messageDate` (no overwrite)
 * - Skip if source has no `messageDate`
 *
 * Usage (from RV-placements-backend):
 *   node scripts/backfill-messageDate-to-visits.js
 *   node scripts/backfill-messageDate-to-visits.js --dry-run
 *
 * Requires: MONGO_URI in .env
 */

import { existsSync, readFileSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

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

const SOURCE_COPY = "companies1_copy";
const TARGET_VISITS = "company_visits";
const DRY_RUN = process.argv.includes("--dry-run");

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function hasMeaningfulMessageDate(visit) {
  if (!visit || typeof visit !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(visit, "messageDate")) return false;
  const v = visit.messageDate;
  return v != null;
}

/**
 * @param {unknown} v
 */
function isPresentInSource(v) {
  return v != null;
}

async function main() {
  // Read path is only companies1_copy; production "companies1" is never opened.

  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("Missing MONGO_URI in environment (set in .env).");
    process.exit(1);
  }

  if (DRY_RUN) {
    log("MODE: DRY-RUN (no writes)");
  } else {
    log("MODE: LIVE (updates company_visits.messageDate only)");
  }
  log("Read-only source:", SOURCE_COPY);
  log("Update target:", TARGET_VISITS);
  log("");

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle");

  const sourceCol = db.collection(SOURCE_COPY);
  const visitsCol = db.collection(TARGET_VISITS);

  let totalScanned = 0;
  let updated = 0;
  let alreadyPresent = 0;
  let skippedNoMessageDateInSource = 0;
  let skippedNoSourceCopyId = 0;
  let skippedSourceNotFound = 0;

  const cursor = visitsCol.find({});

  for await (const v of cursor) {
    totalScanned += 1;

    if (hasMeaningfulMessageDate(v)) {
      alreadyPresent += 1;
      continue;
    }

    const ref = v.sourceCopyId;
    if (ref == null) {
      skippedNoSourceCopyId += 1;
      continue;
    }

    const source = await sourceCol.findOne({ _id: ref });
    if (!source) {
      skippedSourceNotFound += 1;
      continue;
    }

    if (!isPresentInSource(source.messageDate)) {
      skippedNoMessageDateInSource += 1;
      continue;
    }

    const value = source.messageDate;

    if (DRY_RUN) {
      log(
        "[dry-run] would set messageDate on visit",
        String(v._id),
        "from sourceCopyId",
        String(ref)
      );
      updated += 1;
    } else {
      const res = await visitsCol.updateOne(
        { _id: v._id },
        { $set: { messageDate: value } }
      );
      if (res.modifiedCount > 0) {
        updated += 1;
      }
    }
  }

  log("");
  log("=== backfill messageDate — summary ===");
  log("total scanned:", totalScanned);
  log("updated:", updated);
  log("already present (messageDate on visit, skipped):", alreadyPresent);
  log("skipped — no sourceCopyId on visit:", skippedNoSourceCopyId);
  log("skipped — source not found in", SOURCE_COPY + ":", skippedSourceNotFound);
  log("skipped — no messageDate in source doc:", skippedNoMessageDateInSource);

  await mongoose.connection.close();
  log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
