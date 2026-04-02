import express from "express";
import mongoose from "mongoose";
import authJWT from "../middleware/authJWT.js";

const router = express.Router();

// Get student data by USN from student-data-2026-cse collection
router.get("/student-data/:usn", authJWT, async (req, res) => {
  try {
    const { usn } = req.params;
    
    if (!usn) {
      return res.status(400).json({ error: "USN is required" });
    }

    // Connect to the student data collection (users_2026)
    const db = mongoose.connection.db;
    const studentDataCollection = db.collection("users_2026");
    
    // Escape special regex characters in USN
    const escapedUSN = usn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Find student by USN (case-insensitive)
    const studentData = await studentDataCollection.findOne({
      USN: { $regex: new RegExp(`^${escapedUSN}$`, "i") }
    });

    if (!studentData) {
      return res.status(404).json({ error: "Student not found with the provided USN" });
    }

    // Return student data (read-only, no modifications)
    res.json(studentData);
  } catch (error) {
    console.error("❌ Error fetching student data:", error.message);
    res.status(500).json({ error: "Server error while fetching student data" });
  }
});

// DEPRECATED: Name-based lookup removed for security. Use /profile instead.
router.get("/student-data-by-name/:username", authJWT, (req, res) => {
  console.warn(`⚠️ [DEPRECATED] Name-based lookup attempted for: "${req.params.username}". Use /profile instead.`);
  return res.status(410).json({ error: "Name-based lookup is disabled. Use /api/students/profile instead." });
});

// Get student profile by logged-in user email
router.get("/profile", authJWT, async (req, res) => {
  try {
    if (!req.user || !req.user.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const email = req.user.email.toLowerCase();
    console.log(`👤 [Profile] Fetching for email: ${email}`);

    // Connect to the users_2026 collection
    const db = mongoose.connection.db;
    const usersCollection = db.collection("users_2026");

    const studentData = await usersCollection.findOne({ 
      $or: [
        { emailId: email },
        { email: email }
      ]
    });

    if (!studentData) {
      console.log(`❓ [Profile] No profile record found in users_2026 for: ${email}`);
      return res.status(404).json({ error: "Profile not found" });
    }

    console.log(`✅ [Profile] Found Record: ${studentData.Name} -> ${studentData.Company}`);
    res.json(studentData);
  } catch (error) {
    console.error("❌ Error fetching student profile:", error.message);
    res.status(500).json({ error: "Server error while fetching student profile" });
  }
});

export default router;
