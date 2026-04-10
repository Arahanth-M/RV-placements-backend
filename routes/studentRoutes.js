import express from "express";
import mongoose from "mongoose";
import authJWT from "../middleware/authJWT.js";
import requireAdmin from "../middleware/requireAdmin.js";
import {
  getCachedStudentProfile,
  setCachedStudentProfile,
  invalidateStudentProfileCacheByEmail,
  invalidateStudentProfileCacheByEmails,
} from "../services/studentProfileCache.js";
import { ADMIN_EMAIL } from "../config/constants.js";

const router = express.Router();

function normalizeCompanyId(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && raw !== null && raw.$oid) return String(raw.$oid);
  return String(raw);
}

function normalizeText(raw) {
  if (raw == null) return "";
  return String(raw).trim();
}

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

    const email = (req.user.email || "").trim().toLowerCase();
    const adminEmail = String(ADMIN_EMAIL || "").trim().toLowerCase();
    console.log(`👤 [Profile] Fetching for email: ${email}`);

    const cachedProfile = await getCachedStudentProfile(email);
    if (cachedProfile) {
      console.log(`⚡ [Profile] Cache hit for ${email}`);
      return res.json(cachedProfile);
    }
    console.log(`🧊 [Profile] Cache miss for ${email}`);

    // Connect to the users_2026 collection
    const db = mongoose.connection.db;
    const usersCollection = db.collection("users_2026");

    // Escape special regex characters in email
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const studentRows = await usersCollection.find({
      $or: [
        { emailId: { $regex: new RegExp(`^${escapedEmail}$`, "i") } },
        { email: { $regex: new RegExp(`^${escapedEmail}$`, "i") } }
      ]
    }).toArray();

    if (!studentRows || studentRows.length === 0) {
      console.log(`❓ [Profile] No profile record found in users_2026 for: ${email}`);
      
      // If user is admin, provide specialized error
      if (email === adminEmail) {
        return res.status(404).json({ 
          error: "Admin Profile Not Found", 
          message: "Admins do not have a student profile stored in users_2026." 
        });
      }

      return res.status(404).json({ error: "Profile not found" });
    }

    // Base response keeps backward compatibility with existing fields.
    const primaryRow = studentRows[0];

    // Dedupe company names from the Company field across all rows.
    // Includes all associated companies irrespective of offer status/value.
    const companyNameSet = new Map();
    for (const row of studentRows) {
      const companyName = normalizeText(row?.Company || row?.company);
      if (!companyName) continue;

      const key = companyName.toLowerCase();
      if (!companyNameSet.has(key)) {
        companyNameSet.set(key, companyName);
      }
    }

    const placementCompanies = Array.from(companyNameSet.values()).map((companyName) => ({
      companyName,
    }));

    // Preserve original shape while upgrading for multi-row students.
    const responsePayload = {
      ...primaryRow,
      placementCompanies,
      companyId: normalizeCompanyId(primaryRow?.companyId) || null,
      Company:
        placementCompanies[0]?.companyName ||
        primaryRow?.Company ||
        primaryRow?.company ||
        "",
    };

    console.log(
      `✅ [Profile] Found ${studentRows.length} row(s), ${placementCompanies.length} associated compan${placementCompanies.length === 1 ? "y" : "ies"} for ${email}`
    );

    await setCachedStudentProfile(email, responsePayload);
    res.json(responsePayload);
  } catch (error) {
    console.error("❌ Error fetching student profile:", error.message);
    res.status(500).json({ error: "Server error while fetching student profile" });
  }
});

// Admin utility: invalidate one or more cached student profiles after users_2026 updates.
router.post("/profile/cache-invalidate", authJWT, requireAdmin, async (req, res) => {
  try {
    const singleEmail = typeof req.body?.email === "string" ? req.body.email : "";
    const emailList = Array.isArray(req.body?.emails) ? req.body.emails : [];

    const merged = [...emailList, singleEmail].filter((item) => typeof item === "string");
    if (merged.length === 0) {
      return res.status(400).json({
        error: "Provide at least one email in body: { email } or { emails: [] }",
      });
    }

    const result = await invalidateStudentProfileCacheByEmails(merged);
    return res.json({
      message: "Student profile cache invalidation completed",
      ...result,
    });
  } catch (error) {
    console.error("❌ Error invalidating student profile cache:", error.message);
    return res.status(500).json({ error: "Server error while invalidating cache" });
  }
});

// Self utility: clear current user's cached profile and force fresh DB read next time.
router.post("/profile/cache-invalidate-self", authJWT, async (req, res) => {
  try {
    const email = (req.user?.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "No authenticated email found" });
    }
    await invalidateStudentProfileCacheByEmail(email);
    return res.json({ message: "Current user profile cache invalidated", email });
  } catch (error) {
    console.error("❌ Error invalidating current user profile cache:", error.message);
    return res.status(500).json({ error: "Server error while invalidating self cache" });
  }
});

export default router;
