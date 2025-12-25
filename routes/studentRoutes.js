import express from "express";
import mongoose from "mongoose";
import requireAuth from "../middleware/requireAuth.js";

const router = express.Router();

// Get student data by USN from student-data-2026-cse collection
router.get("/student-data/:usn", requireAuth, async (req, res) => {
  try {
    const { usn } = req.params;
    
    if (!usn) {
      return res.status(400).json({ error: "USN is required" });
    }

    // Connect to the student data collection
    const db = mongoose.connection.db;
    const studentDataCollection = db.collection("student-data-2026-cse");
    
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

// Get student data by username/name from student-data-2026-cse collection
router.get("/student-data-by-name/:username", requireAuth, async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    // Connect to the student data collection
    const db = mongoose.connection.db;
    const studentDataCollection = db.collection("student-data-2026-cse");
    
    // Escape special regex characters in username
    const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Normalize username for comparison (trim, lowercase)
    const normalizeName = (name) => {
      if (!name) return '';
      return name.trim().toLowerCase().replace(/\s+/g, ' ');
    };
    
    const normalizedSearchName = normalizeName(username);
    
    // Find student by Name field (case-insensitive, flexible matching)
    // Try exact match first, then partial match
    let studentData = await studentDataCollection.findOne({
      $or: [
        { Name: { $regex: new RegExp(`^${escapedUsername}$`, "i") } },
        { name: { $regex: new RegExp(`^${escapedUsername}$`, "i") } },
        { 'Student Name': { $regex: new RegExp(`^${escapedUsername}$`, "i") } }
      ]
    });

    // If exact match not found, try to find by normalized name
    if (!studentData) {
      const allStudents = await studentDataCollection.find({}).toArray();
      studentData = allStudents.find(student => {
        const studentName = student.Name || student.name || student['Student Name'] || '';
        return normalizeName(studentName) === normalizedSearchName;
      });
    }

    if (!studentData) {
      return res.status(404).json({ error: "Student not found with the provided username" });
    }

    // Return student data (read-only, no modifications)
    res.json(studentData);
  } catch (error) {
    console.error("❌ Error fetching student data by username:", error.message);
    res.status(500).json({ error: "Server error while fetching student data" });
  }
});

export default router;

