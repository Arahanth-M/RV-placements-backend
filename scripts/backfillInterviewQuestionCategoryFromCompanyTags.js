/**
 * Set `category` on interviewquestions from `companyTags` + CompanyStatic.business_model.
 * Only writes to the interviewquestions collection.
 *
 *   cd RV-placements-backend && node scripts/backfillInterviewQuestionCategoryFromCompanyTags.js
 *   node scripts/backfillInterviewQuestionCategoryFromCompanyTags.js --dry-run
 */
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import InterviewQuestion from "../models/InterviewQuestion.js";
import {
  buildCompanyNameToCategoryMap,
  categoriesFromCompanyTags,
  normalizeQuestionCategoryList,
} from "../utils/interviewQuestionCategoryFromCompanyTags.js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  await mongoose.connect(
    process.env.MONGO_URI,
    process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : undefined
  );

  const nameToCategory = await buildCompanyNameToCategoryMap();
  const cursor = InterviewQuestion.find({}, { questionId: 1, companyTags: 1, category: 1 }).cursor();

  let scanned = 0;
  let updated = 0;
  let unchanged = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const next = categoriesFromCompanyTags(doc.companyTags, nameToCategory);
    const normalized = normalizeQuestionCategoryList(next);
    const prev = normalizeQuestionCategoryList(doc.category);
    const same =
      prev.length === normalized.length &&
      prev.every((value, index) => value === normalized[index]);

    if (same) {
      unchanged += 1;
      continue;
    }

    if (!DRY_RUN) {
      await InterviewQuestion.updateOne({ _id: doc._id }, { $set: { category: normalized } });
    }
    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        scanned,
        updated,
        unchanged,
        companyNameMappings: nameToCategory.size,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
