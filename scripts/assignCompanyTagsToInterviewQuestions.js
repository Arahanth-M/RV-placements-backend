/**
 * Assign company names from `companies` to interview question bank rows.
 *
 * Rules:
 * - READ only from `companies` (CompanyStatic.name)
 * - WRITE only `interviewquestions.companyTags`
 *
 * Usage (from RV-placements-backend):
 *   node scripts/assignCompanyTagsToInterviewQuestions.js --dry-run
 *   node scripts/assignCompanyTagsToInterviewQuestions.js --round-types "SQL,CS Fundamentals"
 *   node scripts/assignCompanyTagsToInterviewQuestions.js --only-empty --merge
 *   node scripts/assignCompanyTagsToInterviewQuestions.js --min-tags 1 --max-tags 3 --seed 42
 *   node scripts/assignCompanyTagsToInterviewQuestions.js --round-types "System Design" --first-companies 30
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
const INTERVIEW_QUESTIONS_COLLECTION = "interviewquestions";

const DEFAULT_ROUND_TYPES = ["SQL", "CS Fundamentals"];

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const ONLY_EMPTY = argv.includes("--only-empty");
const MERGE = argv.includes("--merge");

function readIntFlag(name, fallback) {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx === argv.length - 1) return fallback;
  const parsed = Number(argv[idx + 1]);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function readStringFlag(name, fallback = "") {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx === argv.length - 1) return fallback;
  return String(argv[idx + 1] || "").trim();
}

const TARGET_ROUND_TYPES = readStringFlag("--round-types", "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const resolvedRoundTypes =
  TARGET_ROUND_TYPES.length > 0 ? TARGET_ROUND_TYPES : DEFAULT_ROUND_TYPES;

const FIRST_COMPANIES = readIntFlag("--first-companies", 0);
const USE_FIRST_COMPANIES = Number.isFinite(FIRST_COMPANIES) && FIRST_COMPANIES > 0;

const MIN_TAGS = Math.max(1, readIntFlag("--min-tags", 1));
const MAX_TAGS = Math.max(MIN_TAGS, readIntFlag("--max-tags", 3));
const SEED = readIntFlag("--seed", NaN);

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function createRng(seed) {
  if (!Number.isFinite(seed)) {
    return Math.random;
  }
  let state = Math.abs(Math.trunc(seed)) % 2147483647 || 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function shuffleInPlace(items, rng) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function pickRandomCompanyTags(allNames, min, max, rng) {
  if (!allNames.length) return [];
  const span = max - min + 1;
  const count = Math.min(allNames.length, min + Math.floor(rng() * span));
  const pool = shuffleInPlace([...allNames], rng);
  return pool.slice(0, count);
}

function normalizeTagList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function shouldUpdateQuestion(doc) {
  if (!ONLY_EMPTY) return true;
  const tags = normalizeTagList(doc.companyTags);
  return tags.length === 0;
}

function buildNextTags(existingTags, picked) {
  if (MERGE) {
    return [...new Set([...existingTags, ...picked])];
  }
  return picked;
}

function tagsEqual(a, b) {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((tag) => setA.has(tag));
}

async function loadCompanyNames(companiesCol, { firstN = 0 } = {}) {
  const query = { name: { $type: "string", $nin: ["", null] } };
  const sort = { name: 1, _id: 1 };

  if (firstN > 0) {
    const docs = await companiesCol
      .find(query, { projection: { _id: 0, name: 1 } })
      .sort(sort)
      .limit(firstN)
      .toArray();
    return docs
      .map((doc) => String(doc?.name || "").trim())
      .filter(Boolean);
  }

  const cursor = companiesCol.find(query, { projection: { _id: 0, name: 1 } }).sort(sort);

  const names = new Set();
  for await (const doc of cursor) {
    const name = String(doc?.name || "").trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("Missing MONGO_URI in environment (set in .env).");
    process.exit(1);
  }

  const rng = createRng(SEED);

  log("=== assign companyTags: companies -> interviewquestions ===");
  log(
    DRY_RUN
      ? "MODE: DRY-RUN (no writes)"
      : "MODE: LIVE (updates interviewquestions.companyTags only)"
  );
  log("Read source:", COMPANIES_COLLECTION);
  log("Write target:", INTERVIEW_QUESTIONS_COLLECTION);
  log("Target round types:", resolvedRoundTypes.join(", "));
  if (USE_FIRST_COMPANIES) {
    log("Company tag source: first", FIRST_COMPANIES, "names (sorted by name)");
  } else {
    log("Company tag source: random", `${MIN_TAGS}-${MAX_TAGS}`, "per question");
    if (Number.isFinite(SEED)) log("RNG seed:", SEED);
  }
  if (ONLY_EMPTY) log("Filter: only questions with empty companyTags");
  if (MERGE) log("Merge: append to existing companyTags (deduped)");
  log("");

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle");

  const companiesCol = db.collection(COMPANIES_COLLECTION);
  const questionsCol = db.collection(INTERVIEW_QUESTIONS_COLLECTION);

  const companyNames = await loadCompanyNames(companiesCol, {
    firstN: USE_FIRST_COMPANIES ? FIRST_COMPANIES : 0,
  });
  if (!companyNames.length) {
    console.error("No company names found in companies collection.");
    await mongoose.disconnect();
    process.exit(1);
  }

  log("Loaded company names:", companyNames.length);
  if (USE_FIRST_COMPANIES) {
    log("Companies used:", companyNames.join(", "));
  }

  const questionFilter = { roundType: { $in: resolvedRoundTypes } };
  const questions = await questionsCol
    .find(questionFilter)
    .project({ _id: 1, questionId: 1, roundType: 1, difficulty: 1, companyTags: 1 })
    .toArray();

  let scanned = 0;
  let skipped = 0;
  let wouldUpdate = 0;
  let updated = 0;

  const bulkOps = [];

  for (const doc of questions) {
    scanned += 1;
    if (!shouldUpdateQuestion(doc)) {
      skipped += 1;
      continue;
    }

    const existing = normalizeTagList(doc.companyTags);
    const picked = USE_FIRST_COMPANIES
      ? [...companyNames]
      : pickRandomCompanyTags(companyNames, MIN_TAGS, MAX_TAGS, rng);
    const nextTags = buildNextTags(existing, picked);

    if (!nextTags.length) {
      skipped += 1;
      continue;
    }

    if (tagsEqual(nextTags, existing)) {
      skipped += 1;
      continue;
    }

    wouldUpdate += 1;

    if (DRY_RUN) {
      log(
        "[dry-run]",
        doc.questionId || doc._id,
        `(${doc.roundType}/${doc.difficulty})`,
        "->",
        JSON.stringify(nextTags)
      );
      continue;
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { companyTags: nextTags } },
      },
    });
  }

  if (!DRY_RUN && bulkOps.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < bulkOps.length; i += BATCH) {
      const chunk = bulkOps.slice(i, i + BATCH);
      const result = await questionsCol.bulkWrite(chunk, { ordered: false });
      updated += result.modifiedCount;
    }
  }

  log("");
  log("=== companyTags assignment summary ===");
  log("company names available:", companyNames.length);
  log("target questions scanned:", scanned);
  log("questions skipped:", skipped);
  log(DRY_RUN ? "questions that would update:" : "questions modified:", DRY_RUN ? wouldUpdate : updated);
  log("collections written:", DRY_RUN ? "(none)" : INTERVIEW_QUESTIONS_COLLECTION);

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
