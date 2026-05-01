import express from "express";
import PlacementData from "../models/PlacementData.js";
import Submission from "../models/Submission.js";
import Student from "../models/Student.js";
import { getCompanyMergedForAdminById } from "../services/companyService.js";
import User1 from "../models/User1.js";
import authJWT from "../middleware/authJWT.js";
import requireSPC from "../middleware/requireSPC.js";
import validateRequest from "../middleware/validateRequest.js";
import { placementDataSchema } from "../validations/placement.validation.js";
import { config, messages } from "../config/constants.js";

const router = express.Router();

function getSafePlacementFormUrl() {
  const rawUrl = config.PLACEMENT_FORM_URL;

  try {
    const parsedUrl = new URL(rawUrl);
    const isGoogleFormsHost = parsedUrl.hostname === "docs.google.com";
    const isAllowedPath = parsedUrl.pathname.startsWith("/forms/d/e/");

    if (isGoogleFormsHost && isAllowedPath) {
      return parsedUrl.toString();
    }
  } catch (error) {
    console.error("Invalid placement form URL:", error.message);
  }

  return null;
}

router.get("/form", (req, res) => {
  const safeFormUrl = getSafePlacementFormUrl();

  if (!safeFormUrl) {
    return res.status(500).json({ error: "Placement form is unavailable" });
  }

  return res.redirect(302, safeFormUrl);
});

// Submit placement form data as submissions (requires admin approval)
router.post(
  "/:companyId/placement-data",
  authJWT,
  validateRequest(placementDataSchema),
  async (req, res) => {
  try {
    const { companyId } = req.params;
    const { onlineQuestions, interviewQuestions, interviewProcess } = req.body;

    if (!companyId) {
      return res.status(400).json({ error: "Company ID is required" });
    }

    const loaded = await getCompanyMergedForAdminById(String(companyId));
    if (!loaded?.staticRow || !loaded.merged) {
      return res.status(404).json({ error: "Company not found" });
    }
    const company = loaded.merged;

    // Sanitize function to prevent XSS
    const sanitizeText = (text) => {
      if (!text || typeof text !== 'string') return '';
      return text.trim().replace(/<script.*?>.*?<\/script>/gi, '');
    };

    const submissions = [];

    // Create submissions for onlineQuestions
    if (onlineQuestions && Array.isArray(onlineQuestions)) {
      const sanitizedQuestions = onlineQuestions
        .map(q => sanitizeText(q))
        .filter(q => q && q.length > 0);
      
      for (const question of sanitizedQuestions) {
        const submission = new Submission({
          companyId,
          type: "onlineQuestions",
          content: JSON.stringify({ question, solution: "" }),
          submittedBy: {
            name: req.user.username,
            email: req.user.email,
          },
          isAnonymous: false,
          status: "pending",
        });
        submissions.push(submission);
      }
    }

    // Create submissions for interviewQuestions
    if (interviewQuestions && Array.isArray(interviewQuestions)) {
      const sanitizedQuestions = interviewQuestions
        .map(q => sanitizeText(q))
        .filter(q => q && q.length > 0);
      
      for (const question of sanitizedQuestions) {
        const submission = new Submission({
          companyId,
          type: "interviewQuestions",
          content: JSON.stringify({ question, solution: "" }),
          submittedBy: {
            name: req.user.username,
            email: req.user.email,
          },
          isAnonymous: false,
          status: "pending",
        });
        submissions.push(submission);
      }
    }

    // Create submissions for interviewProcess
    if (interviewProcess && Array.isArray(interviewProcess)) {
      const sanitizedProcess = interviewProcess
        .map(p => sanitizeText(p))
        .filter(p => p && p.length > 0);
      
      for (const process of sanitizedProcess) {
        const submission = new Submission({
          companyId,
          type: "interviewProcess",
          content: process,
          submittedBy: {
            name: req.user.username,
            email: req.user.email,
          },
          isAnonymous: false,
          status: "pending",
        });
        submissions.push(submission);
      }
    }

    if (submissions.length === 0) {
      return res.status(400).json({ error: "At least one field must be filled" });
    }

    // Save all submissions
    await Submission.insertMany(submissions);

    // Touch the authenticated student account record after submission.
    if (req.user && req.user._id) {
      await User1.findByIdAndUpdate(req.user._id, { lastLoginAt: new Date() }).catch(() => {});
    }

    res.json({ 
      message: messages.SUCCESS.SUBMISSION_RECEIVED,
      submissionsCount: submissions.length,
      company: {
        id: company._id,
        name: company.name
      }
    });
  } catch (error) {
    console.error("❌ Error creating placement submissions:", error.message);
    res.status(500).json({ error: messages.ERROR.SAVE_ERROR });
  }
});

router.post("/spc/submit", authJWT, requireSPC, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = String(req.body?.name || "").trim();
    const usn = String(req.body?.usn || "").trim().toUpperCase();
    const companyPlaced = String(req.body?.companyPlaced || "").trim();
    const typeOfOffer = String(req.body?.typeOfOffer || "").trim();

    if (!email) {
      return res.status(400).json({ message: "Email of student is required" });
    }
    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }
    if (!usn) {
      return res.status(400).json({ message: "USN is required" });
    }
    if (!companyPlaced) {
      return res.status(400).json({ message: "Company placed is required" });
    }
    if (!typeOfOffer) {
      return res.status(400).json({ message: "Type of offer is required" });
    }

    const [studentByEmail, studentByUsn] = await Promise.all([
      Student.findOne({ email }),
      Student.findOne({ usn }),
    ]);

    if (
      studentByEmail &&
      studentByUsn &&
      String(studentByEmail._id) !== String(studentByUsn._id)
    ) {
      return res.status(400).json({
        message: "Email and USN belong to different student records",
      });
    }

    let student = studentByEmail || studentByUsn;
    if (!student) {
      student = await Student.create({
        email,
        name,
        usn,
      });
    } else {
      let shouldSave = false;
      if (student.email !== email) {
        student.email = email;
        shouldSave = true;
      }
      if (student.usn !== usn) {
        student.usn = usn;
        shouldSave = true;
      }
      if (student.name !== name) {
        student.name = name;
        shouldSave = true;
      }
      if (shouldSave) {
        await student.save();
      }
    }

    const duplicate = await PlacementData.findOne({
      studentId: student._id,
      companyPlaced,
      typeOfOffer,
    });

    if (duplicate) {
      return res.status(400).json({ message: "Duplicate entry" });
    }

    const placement = await PlacementData.create({
      studentId: student._id,
      companyPlaced,
      typeOfOffer,
      createdBy: req.user?.id || req.user?._id || req.user?.email || "",
    });

    return res.json({
      message: "Placement data submitted successfully",
      studentId: student._id,
      placementId: placement._id,
    });
  } catch (error) {
    console.error("❌ Error submitting SPC placement data:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/student/status", authJWT, async (req, res) => {
  try {
    const email = req.user.email?.trim().toLowerCase();
    if (!email) {
      return res.json({ isPlaced: false, data: [] });
    }

    const student = await Student.findOne({ email }).select("_id").lean();
    if (!student?._id) {
      return res.json({ isPlaced: false, data: [] });
    }

    const records = await PlacementData.find({ studentId: student._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      isPlaced: records.length > 0,
      data: records,
    });
  } catch (error) {
    console.error("❌ Error fetching student placement status:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;

