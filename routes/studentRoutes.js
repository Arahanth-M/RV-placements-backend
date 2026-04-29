import express from "express";
import mongoose from "mongoose";
import authJWT from "../middleware/authJWT.js";
import checkBetaAccess from "../middleware/checkBetaAccess.js";
import authorize from "../middleware/authorize.js";
import requireAdmin from "../middleware/requireAdmin.js";
import {
  getCachedStudentProfile,
  setCachedStudentProfile,
  invalidateStudentProfileCacheByEmail,
  invalidateStudentProfileCacheByEmails,
} from "../services/studentProfileCache.js";
import {
  ADMIN_EMAIL,
  STUDENT_PROFILE_COLLECTION,
  STUDENT_EMAIL_FIELD,
} from "../config/constants.js";
import validateRequest from "../middleware/validateRequest.js";
import { profileCacheInvalidateSchema } from "../validations/student.validation.js";

const router = express.Router();
const STUDENT_COLLECTION = STUDENT_PROFILE_COLLECTION;
const COMPANY_FIELDS = [
  "Summer internship Company name",
  "FTE Company name",
  "Only internship Company name",
  "FTE and internship Company name",
  "6 months Internship Company name",
  "Company name",
  "Company_Name",
  "Name of Company",
  "company1",
  "company2",
  "company3",
  "company4",
  "company5",
  "Company",
  "company",
];

function isPlacementCompanyField(fieldName) {
  const k = String(fieldName || "");
  return (
    /company\s*name|name\s*of\s*company/i.test(k) ||
    /company[_\s]+name/i.test(k)
  );
}

function normalizeCompanyId(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && raw !== null && raw.$oid) return String(raw.$oid);
  return String(raw);
}

function normalizeText(raw) {
  if (raw == null) return "";
  return String(raw).trim();
}

function extractPlacementCompanyNames(studentRecord) {
  const record = studentRecord && typeof studentRecord === "object" ? studentRecord : {};
  const companyNameSet = new Map();
  const dynamicCompanyFields = Object.keys(record).filter((key) => isPlacementCompanyField(key));
  const candidateFields = [...new Set([...COMPANY_FIELDS, ...dynamicCompanyFields])];

  for (const fieldName of candidateFields) {
    const companyName = normalizeText(record?.[fieldName]);
    if (!companyName) continue;

    const key = companyName.toLowerCase();
    if (!companyNameSet.has(key)) {
      companyNameSet.set(key, companyName);
    }
  }

  return Array.from(companyNameSet.values());
}

function buildPlacementCompanies(studentRecord) {
  return extractPlacementCompanyNames(studentRecord).map((companyName) => ({
    companyName,
  }));
}

// Get student data by USN from STUDENT_PROFILE_COLLECTION
router.get(
  "/student-data/:usn",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin"]),
  async (req, res) => {
  try {
    const { usn } = req.params;
    
    if (!usn) {
      return res.status(400).json({ error: "USN is required" });
    }

    const db = mongoose.connection.db;
    const studentDataCollection = db.collection(STUDENT_COLLECTION);
    
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
router.get(
  "/student-data-by-name/:username",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin"]),
  (req, res) => {
  console.warn(`⚠️ [DEPRECATED] Name-based lookup attempted for: "${req.params.username}". Use /profile instead.`);
  return res.status(410).json({ error: "Name-based lookup is disabled. Use /api/students/profile instead." });
});

// Get student profile by logged-in user email
router.get("/profile", authJWT, checkBetaAccess, authorize(["student", "admin"]), async (req, res) => {
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

    const db = mongoose.connection.db;
    const usersCollection = db.collection(STUDENT_COLLECTION);
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let studentRecord = await usersCollection.findOne({
      [STUDENT_EMAIL_FIELD]: email,
    });

    if (!studentRecord) {
      studentRecord = await usersCollection.findOne({
        [STUDENT_EMAIL_FIELD]: {
          $regex: new RegExp(`^\\s*${escapedEmail}\\s*$`, "i"),
        },
      });
    }

    if (!studentRecord) {
      console.log(`❓ [Profile] No profile record found in ${STUDENT_COLLECTION} for: ${email}`);

      // If user is admin, provide specialized error
      if (email === adminEmail) {
        return res.status(404).json({
          error: "Admin Profile Not Found",
          message: `Admins do not have a student profile stored in ${STUDENT_COLLECTION}.`
        });
      }

      return res.status(404).json({ error: "Profile not found" });
    }

    const placementCompanyNames = extractPlacementCompanyNames(studentRecord);
    const placementCompanies = placementCompanyNames.map((companyName) => ({
      companyName,
    }));
    const primaryCompanyName =
      normalizeText(studentRecord?.Company) ||
      normalizeText(studentRecord?.company) ||
      normalizeText(studentRecord?.Company_Name) ||
      placementCompanyNames[0] ||
      null;
    const hasLegacyCompanyField =
      Boolean(normalizeText(studentRecord?.Company)) ||
      Boolean(normalizeText(studentRecord?.company));
    const responsePayload = {
      ...studentRecord,
      ...(primaryCompanyName && !hasLegacyCompanyField
        ? { Company: primaryCompanyName }
        : {}),
      placementCompanies,
      primaryCompanyName,
      companyId: normalizeCompanyId(studentRecord?.companyId) || null,
    };

    console.log(
      `✅ [Profile] Found 1 record, ${placementCompanies.length} associated compan${placementCompanies.length === 1 ? "y" : "ies"} for ${email}`
    );

    await setCachedStudentProfile(email, responsePayload);
    res.json(responsePayload);
  } catch (error) {
    console.error("❌ Error fetching student profile:", error.message);
    res.status(500).json({ error: "Server error while fetching student profile" });
  }
});

// Admin utility: invalidate one or more cached student profiles after roster updates.
router.post(
  "/profile/cache-invalidate",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin"]),
  requireAdmin,
  validateRequest(profileCacheInvalidateSchema),
  async (req, res) => {
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
router.post(
  "/profile/cache-invalidate-self",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin"]),
  async (req, res) => {
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
