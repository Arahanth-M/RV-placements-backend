import express from "express";
import Company from "../models/Company.js";
import Submission from "../models/Submission.js";
import User from "../models/User.js";
import requireAuth from "../middleware/requireAuth.js";
import { messages } from "../config/constants.js";

const router = express.Router();

// Submit placement form data as submissions (requires admin approval)
router.post("/:companyId/placement-data", requireAuth, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { onlineQuestions, interviewQuestions, interviewProcess } = req.body;

    if (!companyId) {
      return res.status(400).json({ error: "Company ID is required" });
    }

    // Find the company
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

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

    // Update user's fillForm field to true
    if (req.user && req.user._id) {
      await User.findByIdAndUpdate(req.user._id, { fillForm: true });
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

export default router;

