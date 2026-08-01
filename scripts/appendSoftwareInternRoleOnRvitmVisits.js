import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const COLLECTION = "company_visits_with_rvitm";
const NEW_ROLE = {
  roleName: "Software Intern",
  ctc: {},
  collegeId: "rvitm",
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  const col = mongoose.connection.db.collection(COLLECTION);
  const total = await col.countDocuments({});
  console.log({ collection: COLLECTION, db: mongoose.connection.name, total });

  const sampleBefore = await col.findOne({}, { projection: { roles: 1, year: 1, type: 1 } });
  console.log("sampleBeforeLastRole", JSON.stringify(sampleBefore?.roles?.slice(-1)?.[0] || null));

  const result = await col.updateMany(
    {
      roles: {
        $not: {
          $elemMatch: { roleName: "Software Intern", collegeId: "rvitm" },
        },
      },
    },
    { $push: { roles: NEW_ROLE } }
  );

  console.log("updateResult", {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  });

  const sampleAfter = sampleBefore?._id
    ? await col.findOne({ _id: sampleBefore._id }, { projection: { roles: 1 } })
    : null;
  console.log("sampleAfterLastRole", JSON.stringify(sampleAfter?.roles?.slice(-1)?.[0] || null));

  console.log("verify", {
    docsWithNewRole: await col.countDocuments({
      roles: { $elemMatch: { roleName: "Software Intern", collegeId: "rvitm" } },
    }),
    docsMissingNewRole: await col.countDocuments({
      roles: {
        $not: { $elemMatch: { roleName: "Software Intern", collegeId: "rvitm" } },
      },
    }),
  });

  await mongoose.disconnect();
  console.log("done");
}

main().catch(async (e) => {
  console.error("FAILED", e?.message || e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
