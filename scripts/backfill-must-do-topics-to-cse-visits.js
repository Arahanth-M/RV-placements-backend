/**
 * One-off backfill: copy `companies.must_do_topics` to matching CSE visit rows.
 *
 * Rules:
 * - READ from `companies`
 * - WRITE only `company_visits.must_do_topics`
 * - Target only visits for years 2026 and 2027
 * - Target only visits whose cluster is either
 *   "Computer Science and Engineering" or "" (legacy/default CSE slot)
 * - Never updates EC/ME visits
 *
 * Usage (from RV-placements-backend):
 *   node scripts/backfill-must-do-topics-to-cse-visits.js --dry-run
 *   node scripts/backfill-must-do-topics-to-cse-visits.js
 *
 * Requires: MONGO_URI in .env
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const COMPANIES_COLLECTION = "companies";
const VISITS_COLLECTION = "company_visits";
const TARGET_YEARS = [2026, 2027];
const TARGET_CLUSTERS = ["Computer Science and Engineering", ""];
const DRY_RUN = process.argv.includes("--dry-run");

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function hasMustDoTopics(company) {
  if (!company || typeof company !== "object") return false;
  if (!hasOwn(company, "must_do_topics")) return false;
  const value = company.must_do_topics;
  if (Array.isArray(value)) return value.length > 0;
  return value != null;
}

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("Missing MONGO_URI in environment (set in .env).");
    process.exit(1);
  }

  log("=== backfill must_do_topics: companies -> CSE company_visits ===");
  log(
    DRY_RUN
      ? "MODE: DRY-RUN (no writes)"
      : "MODE: LIVE (updates company_visits.must_do_topics only)"
  );
  log("Read source:", COMPANIES_COLLECTION);
  log("Update target:", VISITS_COLLECTION);
  log("Target years:", TARGET_YEARS.join(", "));
  log("Target clusters:", TARGET_CLUSTERS.map((c) => JSON.stringify(c)).join(", "));
  log("");

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle");

  const companiesCol = db.collection(COMPANIES_COLLECTION);
  const visitsCol = db.collection(VISITS_COLLECTION);

  const companyCursor = companiesCol
    .find({ must_do_topics: { $exists: true, $ne: [] } })
    .project({ _id: 1, name: 1, must_do_topics: 1 })
    .sort({ name: 1, _id: 1 });

  let companiesScanned = 0;
  let companiesWithTopics = 0;
  let companiesWithoutTargetVisits = 0;
  let companiesWouldUpdate = 0;
  let visitsMatched = 0;
  let visitsUpdated = 0;

  for await (const company of companyCursor) {
    companiesScanned += 1;

    if (!hasMustDoTopics(company)) {
      continue;
    }

    companiesWithTopics += 1;

    const visitFilter = {
      companyId: company._id,
      year: { $in: TARGET_YEARS },
      cluster: { $in: TARGET_CLUSTERS },
    };

    const matchedCount = await visitsCol.countDocuments(visitFilter);
    if (matchedCount === 0) {
      companiesWithoutTargetVisits += 1;
      log(
        "[skip] no target CSE 2026/2027 visits for",
        String(company.name ?? company._id)
      );
      continue;
    }

    visitsMatched += matchedCount;
    companiesWouldUpdate += 1;

    if (DRY_RUN) {
      log(
        "[dry-run] would copy must_do_topics to",
        matchedCount,
        "visit(s) for",
        String(company.name ?? company._id)
      );
      continue;
    }

    const result = await visitsCol.updateMany(visitFilter, {
      $set: { must_do_topics: company.must_do_topics },
    });

    visitsUpdated += result.modifiedCount;
    log(
      "[updated]",
      String(company.name ?? company._id),
      "matched",
      result.matchedCount,
      "modified",
      result.modifiedCount
    );
  }

  log("");
  log("=== must_do_topics backfill summary ===");
  log("companies scanned with must_do_topics field:", companiesScanned);
  log("companies with non-empty must_do_topics:", companiesWithTopics);
  log("companies with target CSE visits:", companiesWouldUpdate);
  log("companies without target CSE visits:", companiesWithoutTargetVisits);
  log("target visits matched:", visitsMatched);
  log(
    DRY_RUN ? "target visits that would update:" : "target visits modified:",
    DRY_RUN ? visitsMatched : visitsUpdated
  );
  log("EC/ME visits updated: 0 (filter only matches explicit CSE or empty cluster)");

  await mongoose.disconnect();
  log("Done.");
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // Ignore disconnect errors during failure handling.
  }
  process.exit(1);
});
