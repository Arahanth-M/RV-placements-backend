/**
 * One-off APPROXIMATE DAU backfill from users1.lastLoginAt into dau_day_users.
 *
 * Safety:
 * - Does NOT modify users1 (or any other existing collections' documents)
 * - dau_day_users: INSERT ONLY via $setOnInsert (existing day+user rows are never updated)
 * - Approximate: a user only lands on the day of their *current* lastLoginAt
 *
 * Usage (from RV-placements-backend):
 *   node scripts/backfillDauFromLastLogin.js --dry-run
 *   node scripts/backfillDauFromLastLogin.js
 *   node scripts/backfillDauFromLastLogin.js --since=2026-07-01
 *
 * Requires: MONGO_URI in .env
 */

import { existsSync, readFileSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import User1 from "../models/User1.js";
import DauDayUser from "../models/DauDayUser.js";

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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function utcDayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  let since = "2026-07-01";
  for (const a of argv) {
    if (a.startsWith("--since=")) since = a.slice("--since=".length).trim();
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error(`Invalid --since=${since} (use YYYY-MM-DD)`);
  }
  return { dryRun, since };
}

async function main() {
  const { dryRun, since } = parseArgs(process.argv.slice(2));
  const uri = String(process.env.MONGO_URI || "").trim();
  if (!uri) {
    console.error("Missing MONGO_URI in .env");
    process.exit(1);
  }

  const dbName = String(process.env.MONGODB_DB_NAME || "").trim();
  await mongoose.connect(uri, dbName ? { dbName } : undefined);
  console.log(
    `Connected [${mongoose.connection?.db?.databaseName || dbName || "default"}]`
  );
  console.log(
    `Backfill approx DAU from lastLoginAt since ${since} (UTC)` +
      (dryRun ? " [DRY RUN]" : "")
  );

  const sinceDate = new Date(`${since}T00:00:00.000Z`);
  const cursor = User1.find({
    lastLoginAt: { $gte: sinceDate },
  })
    .select("_id email username role lastLoginAt")
    .lean()
    .cursor();

  let scanned = 0;
  let wouldInsert = 0;
  let inserted = 0;
  let skippedExisting = 0;
  let skippedNoLogin = 0;
  const byDay = new Map();

  for await (const u of cursor) {
    scanned += 1;
    if (!u?.lastLoginAt) {
      skippedNoLogin += 1;
      continue;
    }
    const dayKey = utcDayKey(u.lastLoginAt);
    if (dayKey < since) continue;

    const userId = String(u._id);
    byDay.set(dayKey, (byDay.get(dayKey) || 0) + 1);

    if (dryRun) {
      const exists = await DauDayUser.exists({ dayKey, userId });
      if (exists) skippedExisting += 1;
      else wouldInsert += 1;
      continue;
    }

    const now = u.lastLoginAt instanceof Date ? u.lastLoginAt : new Date(u.lastLoginAt);
    const res = await DauDayUser.updateOne(
      { dayKey, userId },
      {
        $setOnInsert: {
          dayKey,
          userId,
          email: String(u.email || "")
            .trim()
            .toLowerCase(),
          username: String(u.username || "").trim(),
          role: String(u.role || "").trim(),
          firstSeenAt: now,
          lastSeenAt: now,
        },
      },
      { upsert: true }
    );

    // upsertedCount === 1 means new doc; matched existing → untouched
    if (res.upsertedCount === 1) inserted += 1;
    else skippedExisting += 1;
  }

  const daySummary = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  console.log("\nApprox users by lastLoginAt day (source scan):");
  for (const [day, count] of daySummary) {
    console.log(`  ${day}: ${count}`);
  }

  console.log("\nResult:");
  console.log(`  scanned users:     ${scanned}`);
  if (dryRun) {
    console.log(`  would insert:      ${wouldInsert}`);
    console.log(`  already present:   ${skippedExisting}`);
  } else {
    console.log(`  inserted (new):    ${inserted}`);
    console.log(`  left unchanged:    ${skippedExisting}`);
  }
  console.log(`  skipped no login:  ${skippedNoLogin}`);
  console.log(
    dryRun
      ? "\nDry run only — no writes. Re-run without --dry-run to insert."
      : "\nDone. Existing dau_day_users rows were not modified."
  );

  await mongoose.disconnect();
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
