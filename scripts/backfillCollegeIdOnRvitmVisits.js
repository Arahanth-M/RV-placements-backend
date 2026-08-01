/**
 * Append three placementGotInBranchStats entries (cse/ise/ece, gotIn:0, collegeId:rvitm)
 * to every doc in company_visits_with_rvitm ONLY.
 *
 * Usage: node scripts/backfillCollegeIdOnRvitmVisits.js
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const COLLECTION = "company_visits_with_rvitm";
const NEW_STATS = [
  { branchCode: "cse", gotIn: 0, collegeId: "rvitm" },
  { branchCode: "ise", gotIn: 0, collegeId: "rvitm" },
  { branchCode: "ece", gotIn: 0, collegeId: "rvitm" },
];

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");

  console.log(`Connecting… collection=${COLLECTION}`);
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  console.log(`Connected db=${mongoose.connection.name}`);

  const col = mongoose.connection.db.collection(COLLECTION);
  const total = await col.countDocuments({});
  console.log(`totalDocs=${total}`);

  const sampleBefore = await col.findOne(
    {},
    { projection: { placementGotInBranchStats: 1, year: 1, type: 1 } }
  );
  console.log(
    "sampleBeforeStatsTail=",
    JSON.stringify(sampleBefore?.placementGotInBranchStats?.slice(-3) || [], null, 2)
  );

  // Push only when the cse/rvitm marker is missing (idempotent enough for this backfill)
  const result = await col.updateMany(
    {
      placementGotInBranchStats: {
        $not: {
          $elemMatch: { branchCode: "cse", collegeId: "rvitm" },
        },
      },
    },
    {
      $push: {
        placementGotInBranchStats: { $each: NEW_STATS },
      },
    }
  );

  console.log("updateResult=", {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    acknowledged: result.acknowledged,
  });

  const sampleAfter = sampleBefore?._id
    ? await col.findOne(
        { _id: sampleBefore._id },
        { projection: { placementGotInBranchStats: 1 } }
      )
    : null;
  console.log(
    "sampleAfterStatsTail=",
    JSON.stringify(sampleAfter?.placementGotInBranchStats?.slice(-3) || [], null, 2)
  );

  const verify = {
    docsWithCseRvitm: await col.countDocuments({
      placementGotInBranchStats: {
        $elemMatch: { branchCode: "cse", collegeId: "rvitm", gotIn: 0 },
      },
    }),
    docsWithIseRvitm: await col.countDocuments({
      placementGotInBranchStats: {
        $elemMatch: { branchCode: "ise", collegeId: "rvitm", gotIn: 0 },
      },
    }),
    docsWithEceRvitm: await col.countDocuments({
      placementGotInBranchStats: {
        $elemMatch: { branchCode: "ece", collegeId: "rvitm", gotIn: 0 },
      },
    }),
    docsMissingCseRvitm: await col.countDocuments({
      placementGotInBranchStats: {
        $not: { $elemMatch: { branchCode: "cse", collegeId: "rvitm" } },
      },
    }),
  };
  console.log("verify=", verify);

  await mongoose.disconnect();
  console.log("done");
}

main().catch(async (err) => {
  console.error("FAILED", err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
