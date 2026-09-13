/**
 * Generate company_platform_content from company_visits_with_rvitm + companies.
 * READ-ONLY on visits. Writes only to company_platform_content.
 *
 * Usage: node scripts/generateCompanyPlatformContent.js
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import { buildPlatformContentDoc } from "./lib/companyPlatformContentFromVisits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const VISITS_COLLECTION = "company_visits_with_rvitm";
const COMPANIES_COLLECTION = "companies";
const PLATFORM_COLLECTION = "company_platform_content";

const VISIT_PROJECTION = {
  companyId: 1,
  onlineQuestions: 1,
  onlineQuestions_solution: 1,
  interviewQuestions: 1,
  interviewQuestions_solution: 1,
  interviewProcess: 1,
  internshipExperience: 1,
  must_do_topics: 1,
  mcqQuestions: 1,
  updatedAt: 1,
};

function clusterHostFromUri(uri) {
  try {
    const withScheme = String(uri || "").replace(/^mongodb\+srv:\/\//, "https://");
    return new URL(withScheme).hostname;
  } catch {
    return "(unparsed)";
  }
}

async function visitFingerprint(col) {
  const total = await col.countDocuments({});
  const sample = await col
    .find({}, { projection: { updatedAt: 1 } })
    .sort({ _id: 1 })
    .limit(5)
    .toArray();
  return {
    total,
    sample: sample.map((d) => `${d._id}:${d.updatedAt ? new Date(d.updatedAt).toISOString() : ""}`),
  };
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");

  const host = clusterHostFromUri(process.env.MONGO_URI);
  const dbName = String(process.env.MONGODB_DB_NAME || "").trim() || undefined;
  console.log(
    `Connecting host=${host} dbName=${dbName || "(from URI)"} visits=${VISITS_COLLECTION} dest=${PLATFORM_COLLECTION}`
  );

  await mongoose.connect(process.env.MONGO_URI, {
    ...(dbName ? { dbName } : {}),
    serverSelectionTimeoutMS: 30000,
  });
  console.log(`Connected db=${mongoose.connection.name}`);

  const db = mongoose.connection.db;
  const visitsCol = db.collection(VISITS_COLLECTION);
  const companiesCol = db.collection(COMPANIES_COLLECTION);
  const platformCol = db.collection(PLATFORM_COLLECTION);

  const fingerprintBefore = await visitFingerprint(visitsCol);
  console.log("visitsFingerprintBefore=", JSON.stringify(fingerprintBefore));

  const visits = await visitsCol.find({}, { projection: VISIT_PROJECTION }).toArray();
  const byCompany = new Map();
  for (const visit of visits) {
    if (!visit?.companyId) continue;
    const id = String(visit.companyId);
    if (!byCompany.has(id)) byCompany.set(id, []);
    byCompany.get(id).push(visit);
  }

  const companyIds = [...byCompany.keys()].map((id) => new mongoose.Types.ObjectId(id));
  const staticRows = await companiesCol
    .find(
      { _id: { $in: companyIds } },
      { projection: { must_do_topics: 1, prev_coding_ques: 1 } }
    )
    .toArray();
  const staticById = new Map(staticRows.map((row) => [String(row._id), row]));

  const docs = [];
  for (const [id, companyVisits] of byCompany.entries()) {
    docs.push(
      buildPlatformContentDoc(
        new mongoose.Types.ObjectId(id),
        companyVisits,
        staticById.get(id) || null
      )
    );
  }

  if (docs.length > 0) {
    const ops = docs.map((doc) => ({
      updateOne: {
        filter: { companyId: doc.companyId },
        update: {
          $set: { ...doc, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        upsert: true,
      },
    }));
    const result = await platformCol.bulkWrite(ops, { ordered: false });
    console.log("platformWrite=", {
      upsertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    });
  }

  await platformCol.createIndex({ companyId: 1 }, { unique: true });

  const fingerprintAfter = await visitFingerprint(visitsCol);
  console.log("visitsFingerprintAfter=", JSON.stringify(fingerprintAfter));
  if (JSON.stringify(fingerprintBefore) !== JSON.stringify(fingerprintAfter)) {
    throw new Error("Visit collection fingerprint changed; aborting conceptually (visits should be untouched).");
  }

  const platformCount = await platformCol.countDocuments({});
  const sample = await platformCol.findOne(
    {},
    {
      projection: {
        companyId: 1,
        onlineQuestions: { $slice: 1 },
        interviewQuestions: { $slice: 1 },
      },
    }
  );
  console.log(
    JSON.stringify(
      {
        visitDocsRead: visits.length,
        companiesWritten: docs.length,
        platformCount,
        sampleCompanyId: sample?.companyId,
        sampleOnlineKind: sample?.onlineQuestions?.[0]?.kind,
        sampleHasCpp: Boolean(sample?.onlineQuestions?.[0]?.solutions?.cpp),
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
