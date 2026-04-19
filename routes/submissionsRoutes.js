import express from "express";
import Submission from "../models/Submission.js";
import User from "../models/User.js";
import authJWT from "../middleware/authJWT.js";
import checkBetaAccess from "../middleware/checkBetaAccess.js";
import authorize from "../middleware/authorize.js";
import validateRequest from "../middleware/validateRequest.js";
import { submissionInputSchema } from "../validations/submission.validation.js";
import { messages } from "../config/constants.js";


const submissionRouter = express.Router();

submissionRouter.post(
  "/",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin"]),
  validateRequest(submissionInputSchema),
  async (req, res) => {
  try {
    const { companyId, type, content, isAnonymous } = req.body;

    if (!companyId || !type || !content) {
      return res.status(400).json({ error: messages.ERROR.MISSING_FIELDS });
    }

    const newSubmission = new Submission({
      companyId,
      type,
      content,
      isAnonymous: isAnonymous === true || isAnonymous === 'true',
      submittedBy: {
        name: req.user.username, 
        email: req.user.email,
      }
    });
    await Promise.all([
      newSubmission.save(),
      User.updateOne(
        { _id: req.user._id },
        { $set: { lastActiveAt: new Date() } }
      ),
    ]);

    res.status(201).json({ message: messages.SUCCESS.SUBMISSION_RECEIVED });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: messages.ERROR.SAVE_ERROR });
  }
});

export default submissionRouter;
