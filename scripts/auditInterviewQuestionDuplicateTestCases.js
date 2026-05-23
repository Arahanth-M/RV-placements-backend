/**
 * Report interview question bank rows with duplicate testcases (same input + expectedOutput).
 *
 * Usage:
 *   cd RV-placements-backend && node scripts/auditInterviewQuestionDuplicateTestCases.js
 *   node scripts/auditInterviewQuestionDuplicateTestCases.js --round-type DSA
 *   node scripts/auditInterviewQuestionDuplicateTestCases.js --verbose --limit 20
 *   node scripts/auditInterviewQuestionDuplicateTestCases.js --fix
 *   node scripts/auditInterviewQuestionDuplicateTestCases.js --fix --dry-run
 *
 * Requires MONGO_URI in .env
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

import { connectDB } from "../config/db.js";
import { config } from "../config/constants.js";
import InterviewQuestion from "../models/InterviewQuestion.js";
import { dedupeTestCases, testCaseDedupeKey } from "../utils/dedupeTestCases.js";

dotenv.config();

const VERBOSE = process.argv.includes("--verbose");
const FIX = process.argv.includes("--fix");
const DRY_RUN = process.argv.includes("--dry-run");
const roundTypeArg = process.argv.find((a) => a.startsWith("--round-type="));
const roundTypeFilter = roundTypeArg ? roundTypeArg.split("=")[1]?.trim() : "";
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 50) : 50;

function countDuplicates(testCases) {
  const keys = [];
  for (const tc of testCases || []) {
    if (!tc || typeof tc !== "object") continue;
    keys.push(testCaseDedupeKey(tc));
  }
  const unique = new Set(keys);
  return {
    total: keys.length,
    unique: unique.size,
    duplicateCount: keys.length - unique.size,
  };
}

async function main() {
  await connectDB(config.MONGO_URI);

  const filter = {};
  if (roundTypeFilter) {
    filter.roundType = new RegExp(`^${roundTypeFilter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  }

  const docs = await InterviewQuestion.find(filter)
    .select({ questionId: 1, title: 1, roundType: 1, testCases: 1 })
    .lean();

  let withDupes = 0;
  let totalRemoved = 0;
  let fixed = 0;
  const samples = [];

  for (const doc of docs) {
    const cases = Array.isArray(doc.testCases) ? doc.testCases : [];
    if (cases.length === 0) continue;
    const { total, unique, duplicateCount } = countDuplicates(cases);
    if (duplicateCount <= 0) continue;
    withDupes += 1;
    totalRemoved += duplicateCount;
    const deduped = dedupeTestCases(cases);
    if (FIX && doc.questionId) {
      if (!DRY_RUN) {
        await InterviewQuestion.updateOne(
          { questionId: doc.questionId },
          { $set: { testCases: deduped } }
        );
      }
      fixed += 1;
    }
    if (samples.length < limit) {
      samples.push({
        questionId: doc.questionId,
        title: doc.title,
        roundType: doc.roundType,
        total,
        unique,
        duplicateCount,
        afterDedupe: deduped.length,
      });
    }
  }

  console.log("=== Interview question testcase duplicate audit ===");
  if (roundTypeFilter) console.log("Filter roundType:", roundTypeFilter);
  console.log("Documents scanned:", docs.length);
  console.log("Documents with duplicate testcases:", withDupes);
  console.log("Total duplicate rows (would remove):", totalRemoved);
  if (FIX) {
    console.log(
      DRY_RUN
        ? `[dry-run] Would fix ${fixed} document(s) — re-run without --dry-run to apply`
        : `Fixed ${fixed} document(s) in interviewquestions`
    );
  }

  if (samples.length > 0) {
    console.log(`\nSample (up to ${limit}):`);
    for (const row of samples) {
      console.log(
        `  ${row.questionId} | ${row.roundType} | ${row.title?.slice(0, 40) || ""} | ` +
          `${row.total} cases → ${row.unique} unique (${row.duplicateCount} dupes)`
      );
    }
  }

  if (VERBOSE && samples.length > 0) {
    console.log("\nVerbose JSON sample:");
    console.log(JSON.stringify(samples.slice(0, 5), null, 2));
  }
}

main()
  .catch((e) => {
    console.error("Audit failed:", e?.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
  });
