import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "RV-placements";
const STUDENTS_COLLECTION = process.env.STUDENTS_COLLECTION || "users_2026";
const COMPANIES_COLLECTION = process.env.COMPANIES_COLLECTION || "companies1";
const BULK_BATCH_SIZE = Number(process.env.BULK_BATCH_SIZE || 500);
const DRY_RUN = process.env.DRY_RUN === "1";

function normalizeCompanyName(value) {
  if (!value || typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function getStudentDisplayName(student) {
  return (
    student.name ||
    student.fullName ||
    student.username ||
    student.email ||
    String(student._id)
  );
}

function getStudentCompanyName(student) {
  const raw = student.Company ?? student.company ?? "";
  return typeof raw === "string" ? raw : "";
}

async function backfillStudentCompanyIds() {
  const client = new MongoClient(MONGODB_URI);

  let processed = 0;
  let matched = 0;
  let noMatch = 0;
  let alreadyHasCompanyId = 0;
  let updated = 0;

  try {
    await client.connect();
    console.log("[backfill] Connected to MongoDB");

    const db = client.db(DB_NAME);
    const studentsCol = db.collection(STUDENTS_COLLECTION);
    const companiesCol = db.collection(COMPANIES_COLLECTION);

    const companyMap = new Map();
    const duplicateCompanyNames = new Set();

    const companyCursor = companiesCol.find(
      { name: { $type: "string", $ne: "" } },
      { projection: { _id: 1, name: 1 } }
    );

    for await (const company of companyCursor) {
      const normalized = normalizeCompanyName(company.name);
      if (!normalized) continue;

      if (!companyMap.has(normalized)) {
        companyMap.set(normalized, company._id);
      } else {
        duplicateCompanyNames.add(normalized);
      }
    }

    if (duplicateCompanyNames.size > 0) {
      console.warn(
        `[backfill] Warning: ${duplicateCompanyNames.size} duplicate company names found (case-insensitive). Using first match.`
      );
    }
    console.log(
      `[backfill] Loaded ${companyMap.size} unique companies for matching`
    );

    const studentsCursor = studentsCol.find(
      {},
      {
        projection: {
          _id: 1,
          Company: 1,
          company: 1,
          companyId: 1,
          name: 1,
          fullName: 1,
          username: 1,
          email: 1,
        },
      }
    );

    let ops = [];

    for await (const student of studentsCursor) {
      processed += 1;
      const studentName = getStudentDisplayName(student);

      if (student.companyId) {
        alreadyHasCompanyId += 1;
        continue;
      }

      const studentCompanyName = getStudentCompanyName(student);
      const normalizedStudentCompany = normalizeCompanyName(studentCompanyName);
      if (!normalizedStudentCompany) {
        noMatch += 1;
        console.warn(
          `[no-match] student="${studentName}" company="${studentCompanyName}"`
        );
        continue;
      }

      const matchedCompanyId = companyMap.get(normalizedStudentCompany);
      if (!matchedCompanyId) {
        noMatch += 1;
        console.warn(
          `[no-match] student="${studentName}" company="${studentCompanyName}"`
        );
        continue;
      }

      matched += 1;
      console.log(
        `[match] student="${studentName}" company="${studentCompanyName}" -> companyId=${matchedCompanyId}`
      );

      ops.push({
        updateOne: {
          filter: { _id: student._id, companyId: { $exists: false } },
          update: { $set: { companyId: matchedCompanyId } },
        },
      });

      if (ops.length >= BULK_BATCH_SIZE) {
        if (!DRY_RUN) {
          const result = await studentsCol.bulkWrite(ops, { ordered: false });
          updated += result.modifiedCount || 0;
        }
        ops = [];
      }
    }

    if (ops.length > 0 && !DRY_RUN) {
      const result = await studentsCol.bulkWrite(ops, { ordered: false });
      updated += result.modifiedCount || 0;
    }

    console.log("[backfill] Completed");
    console.log(`[backfill] processed=${processed}`);
    console.log(`[backfill] matched=${matched}`);
    console.log(`[backfill] noMatch=${noMatch}`);
    console.log(`[backfill] alreadyHasCompanyId=${alreadyHasCompanyId}`);
    console.log(`[backfill] updated=${DRY_RUN ? 0 : updated}`);
    if (DRY_RUN) {
      console.log("[backfill] DRY_RUN=1 (no writes performed)");
    }
  } catch (error) {
    console.error("[backfill] Fatal error:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
    console.log("[backfill] MongoDB connection closed");
  }
}

backfillStudentCompanyIds();
