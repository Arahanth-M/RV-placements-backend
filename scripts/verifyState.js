import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

async function verify() {
  const MONGO_URI = process.env.MONGO_URI;
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    // Check users_2026 for companyId
    const students = await db.collection("users_2026").find({ 
      emailId: { $exists: true, $ne: null } 
    }).toArray();
    
    console.log("\n=== Students with emailId (users_2026) ===");
    students.forEach(s => {
      console.log(`- ${s.Name}: email=${s.emailId}, company=${s.Company}, companyId=${s.companyId || 'MISSING'}`);
    });

    // Check auth users
    const authUsers = await db.collection("users").find({}).toArray();
    console.log("\n=== Auth Users (users collection) ===");
    authUsers.forEach(u => {
      console.log(`- ${u.username} (${u.email}): fillForm=${u.fillForm}`);
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

verify();
