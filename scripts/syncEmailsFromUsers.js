import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

const normalizeName = (name) => {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
};

const getSortedWords = (name) => {
  return normalizeName(name).split(' ').filter(Boolean).sort().join(' ');
};

async function syncEmails() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("MONGO_URI not found");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;
    const authUsersCollection = db.collection("users");
    const students2026Collection = db.collection("users_2026");

    const authUsers = await authUsersCollection.find({}).toArray();
    const students2026 = await students2026Collection.find({}).toArray();

    console.log(`Analyzing ${authUsers.length} authenticated users against ${students2026.length} student records...`);

    let syncedCount = 0;

    for (const authUser of authUsers) {
      if (!authUser.email) continue;
      
      const searchName = authUser.username || authUser.displayName || "";
      if (!searchName) continue;

      const normalizedSearchName = normalizeName(searchName);
      const sortedSearchWords = getSortedWords(searchName);

      // Find match in students2026
      const match = students2026.find(s => {
        const studentName = s.Name || s.name || "";
        const normalizedStudentName = normalizeName(studentName);
        if (!normalizedStudentName) return false;

        return normalizedStudentName === normalizedSearchName || 
               getSortedWords(studentName) === sortedSearchWords;
      });

      if (match) {
        if (!match.emailId) {
          console.log(`🔗 Linking: "${match.Name}" -> ${authUser.email}`);
          await students2026Collection.updateOne(
            { _id: match._id },
            { $set: { emailId: authUser.email.toLowerCase() } }
          );
          syncedCount++;
        } else if (match.emailId !== authUser.email.toLowerCase()) {
          console.log(`⚠️ Email Mismatch for ${match.Name}: Database has ${match.emailId}, Login used ${authUser.email}`);
        }
      } else {
        console.log(`❓ No student record found for Login: "${searchName}" (${authUser.email})`);
      }
    }

    console.log(`\nSync Complete: Linked ${syncedCount} student emails.`);

  } catch (error) {
    console.error("Sync Failed:", error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

syncEmails();
