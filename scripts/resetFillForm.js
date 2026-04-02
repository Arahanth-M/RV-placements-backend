import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

async function resetFillForm() {
  const MONGO_URI = process.env.MONGO_URI;
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;
    const usersCollection = db.collection("users");

    // Reset fillForm to false for all users so they can re-fill
    const result = await usersCollection.updateMany(
      {},
      { $set: { fillForm: false } }
    );

    console.log(`Reset fillForm=false for ${result.modifiedCount} users.`);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

resetFillForm();
