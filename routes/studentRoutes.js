import express from "express";
import authJWT from "../middleware/authJWT.js";
import checkBetaAccess from "../middleware/checkBetaAccess.js";
import authorize from "../middleware/authorize.js";
import requireAdmin from "../middleware/requireAdmin.js";
import Student from "../models/Student.js";
import PlacementData from "../models/PlacementData.js";
import {
  getCachedStudentProfile,
  setCachedStudentProfile,
  invalidateStudentProfileCacheByEmail,
  invalidateStudentProfileCacheByEmails,
} from "../services/studentProfileCache.js";
import {
  buildProfilePayloadFromStudentRecord,
  buildUsnLookupStudentPayload,
} from "../services/studentProfileService.js";
import { isAdminEmail } from "../config/constants.js";
import validateRequest from "../middleware/validateRequest.js";
import { profileCacheInvalidateSchema } from "../validations/student.validation.js";

const router = express.Router();

function usnMatchFilter(usn) {
  const trimmed = String(usn || "").trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { usn: new RegExp(`^${escaped}$`, "i") };
}

router.get(
  "/student-data/:usn",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin", "spc"]),
  async (req, res) => {
    try {
      const { usn } = req.params;
      const filter = usnMatchFilter(usn);
      if (!filter) {
        return res.status(400).json({ error: "USN is required" });
      }

      const studentRecord = await Student.findOne(filter).lean();
      if (!studentRecord) {
        return res
          .status(404)
          .json({ error: "Student not found with the provided USN" });
      }

      const placements = await PlacementData.find({
        studentId: studentRecord._id,
      })
        .sort({ createdAt: -1 })
        .lean();

      res.json(buildUsnLookupStudentPayload(studentRecord, placements));
    } catch (error) {
      console.error("❌ Error fetching student data:", error.message);
      res
        .status(500)
        .json({ error: "Server error while fetching student data" });
    }
  }
);

router.get(
  "/student-data-by-name/:username",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin", "spc"]),
  (req, res) => {
    console.warn(
      `⚠️ [DEPRECATED] Name-based lookup attempted for: "${req.params.username}". Use /profile instead.`
    );
    return res.status(410).json({
      error:
        "Name-based lookup is disabled. Use /api/students/profile instead.",
    });
  }
);

// GET profile: Redis read-through cache (see studentProfileCache.js); invalidated on placement/student updates.
router.get(
  "/profile",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin", "spc"]),
  async (req, res) => {
    try {
      if (!req.user || !req.user.email) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const email = (req.user.email || "").trim().toLowerCase();
      console.log(`👤 [Profile] Fetching for email: ${email}`);

      const cachedProfile = await getCachedStudentProfile(email);
      if (cachedProfile) {
        console.log(`⚡ [Profile] Cache hit for ${email}`);
        return res.json(cachedProfile);
      }
      console.log(`🧊 [Profile] Cache miss for ${email}`);

      const studentRecord = await Student.findOne({ email }).lean();

      if (!studentRecord) {
        console.log(`❓ [Profile] No student record for email: ${email}`);

        if (isAdminEmail(email)) {
          return res.status(404).json({
            error: "Admin Profile Not Found",
            message:
              "Admins do not have a student profile linked to this account.",
          });
        }

        return res.status(404).json({ error: "Profile not found" });
      }

      const responsePayload = await buildProfilePayloadFromStudentRecord(
        studentRecord
      );
      const placementCount = Array.isArray(responsePayload.placements)
        ? responsePayload.placements.length
        : 0;

      console.log(
        `✅ [Profile] Found student record and ${placementCount} placement entr${placementCount === 1 ? "y" : "ies"} for ${email}`
      );

      await setCachedStudentProfile(email, responsePayload);
      res.json(responsePayload);
    } catch (error) {
      console.error("❌ Error fetching student profile:", error.message);
      res
        .status(500)
        .json({ error: "Server error while fetching student profile" });
    }
  }
);

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

      const merged = [...emailList, singleEmail].filter(
        (item) => typeof item === "string"
      );
      if (merged.length === 0) {
        return res.status(400).json({
          error:
            "Provide at least one email in body: { email } or { emails: [] }",
        });
      }

      const result = await invalidateStudentProfileCacheByEmails(merged);
      return res.json({
        message: "Student profile cache invalidation completed",
        ...result,
      });
    } catch (error) {
      console.error("❌ Error invalidating student profile cache:", error.message);
      res
        .status(500)
        .json({ error: "Server error while invalidating cache" });
    }
  }
);

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
      res
        .status(500)
        .json({ error: "Server error while invalidating self cache" });
    }
  }
);

export default router;
