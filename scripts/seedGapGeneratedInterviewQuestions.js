/**
 * Upsert ONLY `scripts/data/prev-coding-gap-generated-seeds.json` into interviewquestions.
 * Does not load Striver/base/extra seed files.
 *
 * By default, merges `companyTags` from CompanyStatic.prev_coding_ques by matching each
 * row to gap seeds only (slug/title index built from this file — not Striver overlap).
 * Pass --no-company-tags to skip the companies scan (tags stay as in JSON, usually []).
 *
 * Usage:
 *   cd RV-placements-backend && node scripts/seedGapGeneratedInterviewQuestions.js
 *   node scripts/seedGapGeneratedInterviewQuestions.js --dry-run
 *   node scripts/seedGapGeneratedInterviewQuestions.js --no-company-tags
 *
 * Requires MONGO_URI.
 */
import dotenv from "dotenv";
import fs from "fs/promises";
import mongoose from "mongoose";

import { connectDB } from "../config/db.js";
import { config } from "../config/constants.js";
import CompanyStatic from "../models/CompanyStatic.js";
import InterviewQuestion from "../models/InterviewQuestion.js";
import { buildSeedIndexes, PREV_CODING_GAP_GENERATED_SEEDS } from "../services/prevCodingImport/buildSeedIndex.js";
import { findSeedForMappedRow, mapPrevCodingRow } from "../services/prevCodingImport/mapPrevCodingRow.js";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry-run");
const NO_COMPANY_TAGS = process.argv.includes("--no-company-tags");

/** @param {unknown[]} arr */
function uniqueCompanyTags(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const s = typeof x === "string" ? x.trim() : String(x || "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/**
 * For each gap seed questionId, collect display company names that list this problem
 * in prev_coding_ques (match via LeetCode slug / normalized title against gap rows only).
 * @param {object[]} gapRows
 * @returns {Promise<Map<string, Set<string>>>} questionId -> company names
 */
async function tagsByQuestionIdFromPrevCoding(gapRows) {
  const indexes = buildSeedIndexes(gapRows);
  const byQid = new Map();

  const companies = await CompanyStatic.find(
    { "prev_coding_ques.0": { $exists: true } },
    { name: 1, prev_coding_ques: 1 }
  )
    .lean()
    .exec();

  for (const co of companies) {
    const companyName = typeof co?.name === "string" ? co.name.trim() : "";
    if (!companyName) continue;
    const items = Array.isArray(co.prev_coding_ques) ? co.prev_coding_ques : [];
    for (const raw of items) {
      const mapped = mapPrevCodingRow(raw);
      const seed = findSeedForMappedRow(indexes, mapped);
      const qid = seed && typeof seed.questionId === "string" ? seed.questionId.trim() : "";
      if (!qid) continue;
      let set = byQid.get(qid);
      if (!set) {
        set = new Set();
        byQid.set(qid, set);
      }
      set.add(companyName);
    }
  }

  return byQid;
}

function resolveQuestionUrl(row) {
  const direct = typeof row?.url === "string" ? row.url.trim() : "";
  if (direct) return direct;
  const src = typeof row?.sourceMetadata?.source === "string" ? row.sourceMetadata.source.trim() : "";
  if (/^https?:\/\//i.test(src)) return src;
  return "";
}

async function main() {
  await connectDB(config.MONGO_URI);

  const raw = await fs.readFile(PREV_CODING_GAP_GENERATED_SEEDS, "utf8");
  const seedRows = JSON.parse(raw);
  if (!Array.isArray(seedRows)) {
    throw new Error(`Gap seed file must be a JSON array: ${PREV_CODING_GAP_GENERATED_SEEDS}`);
  }

  /** @type {Map<string, Set<string>> | null} */
  let tagsByQid = null;
  if (!NO_COMPANY_TAGS) {
    tagsByQid = await tagsByQuestionIdFromPrevCoding(seedRows);
    const withTags = [...tagsByQid.values()].filter((s) => s.size > 0).length;
    console.log(
      `[seedGapGeneratedInterviewQuestions] companyTags: matched ${withTags} gap question(s) to prev_coding_ques across companies (prev-coding rows scan).`
    );
  }

  const seenIds = new Set();
  let upserted = 0;
  let taggedCount = 0;
  const errors = [];

  for (let i = 0; i < seedRows.length; i++) {
    const row = seedRows[i];
    const qid = row?.questionId;
    if (!qid || typeof qid !== "string") {
      errors.push({ index: i, reason: "missing questionId" });
      continue;
    }
    if (seenIds.has(qid)) {
      errors.push({ index: i, questionId: qid, reason: "duplicate questionId in gap seed file" });
      continue;
    }
    seenIds.add(qid);

    const fromDb = tagsByQid?.get(qid);
    const companyTags = uniqueCompanyTags([
      ...(Array.isArray(row.companyTags) ? row.companyTags : []),
      ...(fromDb ? Array.from(fromDb) : []),
    ]);
    if (companyTags.length > 0) taggedCount += 1;

    const doc = { ...row, url: resolveQuestionUrl(row), companyTags };

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
    `[seedGapGeneratedInterviewQuestions] ${DRY_RUN ? "Dry-run validated" : "Upserted"} ${upserted}/${seedRows.length} gap question(s)` +
      (NO_COMPANY_TAGS ? "." : `; ${taggedCount} with at least one company tag.`)
  );
  if (errors.length) {
    console.error("[seedGapGeneratedInterviewQuestions] Errors:", errors);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("[seedGapGeneratedInterviewQuestions] Fatal:", e?.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
  });
