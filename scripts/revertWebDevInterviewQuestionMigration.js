/**
 * Undo migrateFrontendQuestionsToWebDevRound.js:
 *   roundType: Web Dev  →  CS Fundamentals
 *   roleTags: ["Frontend Engineer"]  →  canonical CS Fundamentals role bundle
 *
 * Only updates interviewquestions (docs currently roundType Web Dev).
 *
 *   node scripts/revertWebDevInterviewQuestionMigration.js --dry-run
 *   node scripts/revertWebDevInterviewQuestionMigration.js
 */
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import InterviewQuestion from "../models/InterviewQuestion.js";

const DRY_RUN = process.argv.includes("--dry-run");

/** Same nine roles applied to all CS Fundamentals rows (Sep 2026 bulk tag). */
const CS_FUNDAMENTALS_ROLE_TAGS = [
  "Software Engineer (SDE)",
  "Backend Engineer",
  "Full Stack Engineer",
  "DevOps/Cloud Engineer",
  "QA/SDET",
  "Data Engineer",
  "AI/ML Engineer",
  "Frontend Engineer",
  "Embedded Systems Engineer",
];

async function main() {
  await mongoose.connect(
    process.env.MONGO_URI,
    process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : undefined
  );

  const filter = { roundType: "Web Dev" };
  const count = await InterviewQuestion.countDocuments(filter);

  if (DRY_RUN) {
    const sample = await InterviewQuestion.find(filter)
      .limit(5)
      .select({ questionId: 1, roundType: 1, roleTags: 1 })
      .lean();
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          matched: count,
          restoreRoundType: "CS Fundamentals",
          restoreRoleTags: CS_FUNDAMENTALS_ROLE_TAGS,
          sample,
        },
        null,
        2
      )
    );
    await mongoose.disconnect();
    return;
  }

  const result = await InterviewQuestion.updateMany(filter, {
    $set: {
      roundType: "CS Fundamentals",
      roleTags: CS_FUNDAMENTALS_ROLE_TAGS,
    },
  });

  const webDevLeft = await InterviewQuestion.countDocuments({ roundType: "Web Dev" });
  const csFe = await InterviewQuestion.countDocuments({
    roundType: "CS Fundamentals",
    roleTags: "Frontend Engineer",
  });
  const csWithAllNine = await InterviewQuestion.countDocuments({
    roundType: "CS Fundamentals",
    roleTags: { $all: CS_FUNDAMENTALS_ROLE_TAGS },
  });

  console.log(
    JSON.stringify(
      {
        dryRun: false,
        matched: result.matchedCount ?? count,
        modified: result.modifiedCount,
        webDevRemaining: webDevLeft,
        csFundamentalsWithFrontendEngineer: csFe,
        csFundamentalsWithAllNineRoles: csWithAllNine,
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
