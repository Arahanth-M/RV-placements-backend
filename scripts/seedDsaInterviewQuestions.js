/**
 * Loads DSA InterviewQuestion documents from bundled JSON into MongoDB.
 *
 * Data sources (JSON in-repo; no network fetch):
 *   - scripts/data/dsa-interview-seeds.json (base set)
 *   - scripts/data/striver-sde-sheet/bulk-part-01.json … bulk-part-05.json (100 SDE-sheet rows)
 *
 * Company tags: READ-ONLY query against CompanyStatic (collection "companies").
 * Tags are assigned by round-robin over distinct company names; no writes to companies.
 *
 * Writes: ONLY interviewquestions (InterviewQuestion model) via upsert on questionId.
 *
 * Usage:
 *   cd RV-placements-backend && node scripts/seedDsaInterviewQuestions.js
 *   node scripts/seedDsaInterviewQuestions.js --dry-run
 *
 * Requires MONGO_URI (see config/constants.js default for local).
 */
import dotenv from "dotenv";
import fs from "fs/promises";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

import { connectDB } from "../config/db.js";
import { config } from "../config/constants.js";
import CompanyStatic from "../models/CompanyStatic.js";
import InterviewQuestion from "../models/InterviewQuestion.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILES = [
  path.join(__dirname, "data", "dsa-interview-seeds.json"),
  ...[1, 2, 3, 4, 5].map((n) =>
    path.join(__dirname, "data", "striver-sde-sheet", `bulk-part-0${n}.json`)
  ),
];

const TAGS_PER_QUESTION = 3;
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Spread tags across the full company list (read-only names). Uses several modular
 * strides so different companies co-occur and the set rotates through the DB list.
 * @param {string[]} names distinct non-empty company display names
 * @param {number} index question index in merged seed array
 */
function pickCompanyTags(names, index) {
  if (!Array.isArray(names) || names.length === 0) return [];
  const n = names.length;
  const positions = [
    index % n,
    (index * 97 + 23) % n,
    (index * 53 + 11) % n,
  ].slice(0, Math.min(TAGS_PER_QUESTION, n));
  return [...new Set(positions.map((p) => names[p]))];
}

async function loadSeedRows() {
  const chunks = await Promise.all(
    SEED_FILES.map(async (filePath) => {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error(`Seed file must be a JSON array: ${filePath}`);
      }
      return parsed;
    })
  );
  return chunks.flat();
}

async function readCompanyDisplayNames() {
  const rows = await CompanyStatic.find({}, { name: 1, _id: 0 }).lean();
  const names = rows
    .map((r) => (typeof r?.name === "string" ? r.name.trim() : ""))
    .filter(Boolean);
  return [...new Set(names)];
}

async function main() {
  const uri = config.MONGO_URI;
  await connectDB(uri);

  const [seedRows, companyNames] = await Promise.all([loadSeedRows(), readCompanyDisplayNames()]);

  if (companyNames.length === 0) {
    console.warn(
      "[seedDsaInterviewQuestions] No company names found in companies collection; companyTags will be empty."
    );
  } else {
    console.log(
      `[seedDsaInterviewQuestions] Loaded ${companyNames.length} distinct company name(s) for tagging (read-only).`
    );
  }

  const seenIds = new Set();
  let upserted = 0;
  const errors = [];

  for (let i = 0; i < seedRows.length; i++) {
    const row = seedRows[i];
    const qid = row?.questionId;
    if (!qid || typeof qid !== "string") {
      errors.push({ index: i, reason: "missing questionId" });
      continue;
    }
    if (seenIds.has(qid)) {
      errors.push({ index: i, questionId: qid, reason: "duplicate questionId in seed file" });
      continue;
    }
    seenIds.add(qid);

    const companyTags = pickCompanyTags(companyNames, i);
    const doc = { ...row, companyTags };

    try {
      const model = new InterviewQuestion(doc);
      await model.validate();
    } catch (e) {
      errors.push({ index: i, questionId: qid, reason: e?.message || String(e) });
      continue;
    }

    if (DRY_RUN) {
      upserted += 1;
      continue;
    }

    const { questionId, ...rest } = doc;
    await InterviewQuestion.updateOne(
      { questionId },
      { $set: { questionId, ...rest } },
      { upsert: true, runValidators: true }
    );
    upserted += 1;
  }

  console.log(
    `[seedDsaInterviewQuestions] ${DRY_RUN ? "Dry-run validated" : "Upserted"} ${upserted}/${seedRows.length} question(s).`
  );
  if (errors.length) {
    console.error("[seedDsaInterviewQuestions] Errors:", errors);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("[seedDsaInterviewQuestions] Fatal:", e?.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
  });
