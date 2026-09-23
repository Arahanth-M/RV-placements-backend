/**
 * Move all interviewquestions that include Frontend Engineer in roleTags to:
 *   roundType: Web Dev
 *   roleTags: ["Frontend Engineer"]
 *
 * Only updates the interviewquestions collection.
 *
 *   node scripts/migrateFrontendQuestionsToWebDevRound.js --dry-run
 *   node scripts/migrateFrontendQuestionsToWebDevRound.js
 */
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import InterviewQuestion from "../models/InterviewQuestion.js";

const DRY_RUN = process.argv.includes("--dry-run");
const FRONTEND_ROLE = "Frontend Engineer";

async function main() {
  await mongoose.connect(
    process.env.MONGO_URI,
    process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : undefined
  );

  const filter = { roleTags: FRONTEND_ROLE };
  const count = await InterviewQuestion.countDocuments(filter);

  if (DRY_RUN) {
    const sample = await InterviewQuestion.find(filter)
      .limit(5)
      .select({ questionId: 1, roundType: 1, roleTags: 1 })
      .lean();
    console.log(
      JSON.stringify({ dryRun: true, matched: count, sample }, null, 2)
    );
    await mongoose.disconnect();
    return;
  }

  const result = await InterviewQuestion.updateMany(filter, {
    $set: {
      roundType: "Web Dev",
      roleTags: [FRONTEND_ROLE],
    },
  });

  console.log(
    JSON.stringify(
      {
        dryRun: false,
        matched: result.matchedCount ?? count,
        modified: result.modifiedCount,
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
