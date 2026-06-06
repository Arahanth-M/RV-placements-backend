/**
 * Normalize every DSA bank question to 2 visible (samples) + 2 hidden (edge cases).
 * Generates missing hidden cases via Groq when existing data only duplicates visible examples.
 *
 * Usage:
 *   cd RV-placements-backend
 *   node scripts/seedDsaTwoVisibleTwoHiddenTestCases.js --dry-run
 *   node scripts/seedDsaTwoVisibleTwoHiddenTestCases.js --write-json --dry-run
 *   node scripts/seedDsaTwoVisibleTwoHiddenTestCases.js --write-json
 *   node scripts/seedDsaTwoVisibleTwoHiddenTestCases.js --fix-mongo
 *   node scripts/seedDsaTwoVisibleTwoHiddenTestCases.js --write-json --fix-mongo
 *   node scripts/seedDsaTwoVisibleTwoHiddenTestCases.js --limit=5 --question-id=gap-leetcode-two-sum
 *   node scripts/seedDsaTwoVisibleTwoHiddenTestCases.js --no-llm   # restructure only; report gaps
 *
 * Requires GROQ_API_KEY (or GROQ_API_KEY_*) when hidden cases must be generated (default).
 * Requires MONGO_URI for --fix-mongo.
 */
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

import { connectDB } from "../config/db.js";
import { config } from "../config/constants.js";
import InterviewQuestion from "../models/InterviewQuestion.js";
import { PREV_CODING_GAP_GENERATED_SEEDS } from "../services/prevCodingImport/buildSeedIndex.js";
import {
  buildTwoVisibleTwoHidden,
  HIDDEN_EDGE_COUNT,
  VISIBLE_SAMPLE_COUNT,
} from "./lib/dsaTestCaseLayout.js";
import { generateHiddenTestCasesWithRetry } from "./lib/generateDsaHiddenTestCases.js";
import { testCaseDedupeKey } from "../utils/dedupeTestCases.js";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry-run");
const WRITE_JSON = process.argv.includes("--write-json");
const FIX_MONGO = process.argv.includes("--fix-mongo");
const NO_LLM = process.argv.includes("--no-llm");
const BACKUP_JSON = !process.argv.includes("--no-backup");

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 0) : 0;

const questionIdArg = process.argv.find((a) => a.startsWith("--question-id="));
const questionIdFilter = questionIdArg ? questionIdArg.split("=")[1]?.trim() : "";

const delayArg = process.argv.find((a) => a.startsWith("--delay-ms="));
const delayMs = delayArg ? Math.max(0, Number(delayArg.split("=")[1]) || 300) : 300;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.join(__dirname, "data", "dsa-two-two-seed-report.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function countLayout(testCases) {
  const cases = Array.isArray(testCases) ? testCases : [];
  const visible = cases.filter((tc) => tc && tc.isHidden !== true);
  const hidden = cases.filter((tc) => tc && tc.isHidden === true);
  const keys = cases.map(testCaseDedupeKey);
  return {
    visible: visible.length,
    hidden: hidden.length,
    unique: new Set(keys).size,
    ok:
      visible.length >= VISIBLE_SAMPLE_COUNT &&
      hidden.length >= HIDDEN_EDGE_COUNT &&
      new Set(keys).size >= VISIBLE_SAMPLE_COUNT + HIDDEN_EDGE_COUNT,
  };
}

async function processRow(row, stats) {
  const roundType = String(row.roundType || "").toUpperCase();
  if (roundType !== "DSA") return;

  const questionId = String(row.questionId || "").trim();
  if (!questionId) return;

  const layout = buildTwoVisibleTwoHidden(row.testCases);
  let visible = layout.visible;
  let hidden = layout.hidden;

  if (layout.visibleNeeded > 0) {
    stats.visibleShort += 1;
    if (!NO_LLM) {
      stats.errors.push({ questionId, error: `only ${visible.length} unique visible cases` });
      return;
    }
  }

  if (layout.hiddenNeeded > 0) {
    stats.needLlm += 1;
    if (NO_LLM) {
      stats.skippedLlm += 1;
      stats.errors.push({
        questionId,
        error: `need ${layout.hiddenNeeded} hidden case(s); re-run without --no-llm`,
      });
      return;
    }

    try {
      const generated = await generateHiddenTestCasesWithRetry({
        title: row.title,
        question: row.question,
        functionSignature: row.dsaMetadata?.functionSignature || "",
        visibleCases: visible,
        count: layout.hiddenNeeded,
        excludeKeys: new Set(hidden.map(testCaseDedupeKey)),
      });
      hidden = [...hidden, ...generated].slice(0, HIDDEN_EDGE_COUNT);
      stats.llmGenerated += 1;
    } catch (error) {
      stats.llmFailed += 1;
      stats.errors.push({
        questionId,
        error: error?.message || String(error),
      });
      return;
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  const finalCases = [...visible.slice(0, VISIBLE_SAMPLE_COUNT), ...hidden.slice(0, HIDDEN_EDGE_COUNT)];
  const finalLayout = countLayout(finalCases);

  if (!finalLayout.ok) {
    stats.invalid += 1;
    stats.errors.push({
      questionId,
      error: `final layout invalid: visible=${finalLayout.visible} hidden=${finalLayout.hidden} unique=${finalLayout.unique}`,
    });
    return;
  }

  row.testCases = finalCases;
  stats.updated += 1;
  stats.updatedQuestionIds.push(questionId);

  if (finalLayout.visible >= VISIBLE_SAMPLE_COUNT && finalLayout.hidden >= HIDDEN_EDGE_COUNT) {
    stats.ready += 1;
  }
}

async function loadRows() {
  const raw = await fs.readFile(PREV_CODING_GAP_GENERATED_SEEDS, "utf8");
  return JSON.parse(raw);
}

async function saveRows(rows) {
  if (BACKUP_JSON) {
    const backupPath = `${PREV_CODING_GAP_GENERATED_SEEDS}.bak-${Date.now()}`;
    await fs.copyFile(PREV_CODING_GAP_GENERATED_SEEDS, backupPath);
    console.info(`Backup: ${backupPath}`);
  }
  await fs.writeFile(PREV_CODING_GAP_GENERATED_SEEDS, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

async function fixMongo(rows, questionIds) {
  await connectDB(config.MONGO_URI);
  const idSet = new Set(questionIds);
  let upserted = 0;
  for (const row of rows) {
    if (!idSet.has(row.questionId)) continue;
    if (String(row.roundType || "").toUpperCase() !== "DSA") continue;
    if (!row.questionId || !Array.isArray(row.testCases)) continue;
    if (DRY_RUN) {
      upserted += 1;
      continue;
    }
    await InterviewQuestion.updateOne(
      { questionId: row.questionId },
      { $set: { testCases: row.testCases } }
    );
    upserted += 1;
  }
  return upserted;
}

async function main() {
  let rows = await loadRows();
  const dsaRows = rows.filter((r) => String(r.roundType || "").toUpperCase() === "DSA");
  let targets = dsaRows;
  if (questionIdFilter) {
    targets = dsaRows.filter((r) => r.questionId === questionIdFilter);
    if (targets.length === 0) {
      console.error(`No DSA row with questionId=${questionIdFilter}`);
      process.exit(1);
    }
  } else if (limit > 0) {
    targets = dsaRows.slice(0, limit);
  }

  const stats = {
    total: targets.length,
    updated: 0,
    ready: 0,
    needLlm: 0,
    llmGenerated: 0,
    llmFailed: 0,
    skippedLlm: 0,
    visibleShort: 0,
    invalid: 0,
    errors: [],
    updatedQuestionIds: [],
  };

  console.info(
    `Processing ${targets.length} DSA question(s) (dryRun=${DRY_RUN}, writeJson=${WRITE_JSON}, fixMongo=${FIX_MONGO}, noLlm=${NO_LLM})`
  );

  for (const row of targets) {
    await processRow(row, stats);
  }

  if (WRITE_JSON && stats.updated > 0 && !DRY_RUN) {
    await saveRows(rows);
    console.info(`Wrote ${PREV_CODING_GAP_GENERATED_SEEDS}`);
  } else if (WRITE_JSON && DRY_RUN) {
    console.info(`[dry-run] Would write ${stats.updated} row(s) to gap seeds JSON`);
  }

  if (FIX_MONGO && stats.updated > 0) {
    const n = await fixMongo(rows, stats.updatedQuestionIds);
    console.info(`${DRY_RUN ? "[dry-run] Would update" : "Updated"} ${n} MongoDB document(s)`);
  }

  await fs.writeFile(
    REPORT_PATH,
    `${JSON.stringify({ ...stats, at: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );

  console.info("Report:", REPORT_PATH);
  console.info(JSON.stringify(stats, null, 2));

  if (stats.errors.length > 0) {
    console.info("First errors:");
    for (const e of stats.errors.slice(0, 10)) {
      console.info(`  ${e.questionId}: ${e.error}`);
    }
  }

  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }

  process.exit(stats.errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
