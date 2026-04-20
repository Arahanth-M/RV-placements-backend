import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the parent directory (backend root)
dotenv.config({ path: path.join(__dirname, "../.env") });

const COMPANY_FIELDS = [
  "Summer internship Company name",
  "FTE Company name",
  "Only internship Company name",
  "FTE and internship Company name",
  "6 months Internship Company name",
  "Company name",
  "Name of Company",
  "Company",
  "company",
  "company1",
  "company2",
  "company3",
  "company4",
  "company5",
];

function isPlacementCompanyField(fieldName) {
  return /company name|name of company/i.test(fieldName);
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function getStudentCompanyName(user) {
  if (!user || typeof user !== "object") return "";

  const dynamicCompanyFields = Object.keys(user).filter((key) => isPlacementCompanyField(key));
  const candidateFields = [...new Set([...COMPANY_FIELDS, ...dynamicCompanyFields])];

  for (const fieldName of candidateFields) {
    const raw = user[fieldName];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }

  return "";
}

async function migrate() {
  const MONGO_URI = process.env.MONGO_URI;

  if (!MONGO_URI) {
    console.error("MONGO_URI not found in env variables.");
    process.exit(1);
  }

  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected successfully.");

    const db = mongoose.connection.db;
    const usersCollection = db.collection("users_2026");
    const companiesCollection = db.collection("companies1");

    // Fetch all users
    const users = await usersCollection.find({}).toArray();
    console.log(`Starting migration... Found ${users.length} total users.`);

    let matchedCount = 0;
    let unmatchedCount = 0;

    for (const user of users) {
      const companyStr = getStudentCompanyName(user);
      if (!companyStr) {
        unmatchedCount++;
        continue;
      }

      const escapedCompanyName = escapeRegex(companyStr);

      // 1. Try case-insensitive exact match first
      let companyDoc = await companiesCollection.findOne({
        name: { $regex: new RegExp(`^${escapedCompanyName}$`, "i") }
      });

      // 2. Fallback to partial match if not found
      if (!companyDoc) {
        companyDoc = await companiesCollection.findOne({
          name: { $regex: new RegExp(escapedCompanyName, "i") }
        });
      }

      // If a match is found, strictly update the companyId field ONLY
      if (companyDoc && companyDoc._id) {
        await usersCollection.updateOne(
          { _id: user._id },
          { $set: { companyId: companyDoc._id } }
        );
        matchedCount++;
      } else {
        unmatchedCount++;
      }
    }

    console.log("\n--- Migration Summary ---");
    console.log(`Total users processed: ${users.length}`);
    console.log(`Matched (companyId updated): ${matchedCount}`);
    console.log(`Unmatched (skipped): ${unmatchedCount}`);
    console.log("-------------------------\n");

  } catch (error) {
    console.error("Migration crashed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
    process.exit(0);
  }
}

migrate();
