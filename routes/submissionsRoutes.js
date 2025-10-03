import express from "express";
import Submission from "../models/Submission.js";
import requireAuth from "../middleware/requireAuth.js";
import { messages } from "../config/constants.js";


const submissionRouter = express.Router();

submissionRouter.post("/", requireAuth, async (req, res) => {
  try {
    const { companyId, type, content } = req.body;

    if (!companyId || !type || !content) {
      return res.status(400).json({ error: messages.ERROR.MISSING_FIELDS });
    }

    const newSubmission = new Submission({
      ...req.body,
      submittedBy: {
        name: req.user.username, 
        email: req.user.email,
      }
    });
    await newSubmission.save();

    res.status(201).json({ message: messages.SUCCESS.SUBMISSION_RECEIVED });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: messages.ERROR.SAVE_ERROR });
  }
});

export default submissionRouter;
