import express from "express";
import mongoose from "mongoose";
import Submission from "../models/Submission.js";
import authJWT from "../middleware/authJWT.js";
import checkBetaAccess from "../middleware/checkBetaAccess.js";
import authorize from "../middleware/authorize.js";
import validateRequest from "../middleware/validateRequest.js";
import { submissionInputSchema } from "../validations/submission.validation.js";
import { messages } from "../config/constants.js";
import { normalizeCompanyDetailYear } from "../services/companyService.js";
import { getAuthUserModel } from "../utils/authUserModel.js";


const submissionRouter = express.Router();
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

submissionRouter.get(
  "/mine",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin", "spc"]),
  async (req, res) => {
    try {
      const email = (req.user?.email || "").trim().toLowerCase();

      if (!email) {
        return res.status(401).json({ error: messages.ERROR.NOT_AUTHENTICATED });
      }

      const submissions = await Submission.find({
        "submittedBy.email": {
          $regex: new RegExp(`^${escapeRegex(email)}$`, "i"),
        },
      })
        .sort({ submittedAt: -1, _id: -1 })
        .populate("companyId", "name")
        .lean();

      const payload = submissions.map((submission) => ({
        _id: submission._id,
        type: submission.type,
        content: submission.content,
        isAnonymous: submission.isAnonymous === true,
        status: submission.status,
        submittedAt: submission.submittedAt,
        placementYear: submission.placementYear ?? null,
        placementListContext: submission.placementListContext ?? null,
        companyVisitId: submission.companyVisitId
          ? String(submission.companyVisitId)
          : null,
        companyId: submission.companyId?._id || null,
        companyName: submission.companyId?.name || "Unknown company",
      }));

      return res.json({ submissions: payload });
    } catch (error) {
      console.error("Error fetching user submissions:", error);
      return res.status(500).json({ error: "Error fetching submissions" });
    }
  }
);

submissionRouter.post(
  "/",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin", "spc"]),
  validateRequest(submissionInputSchema),
  async (req, res) => {
  try {
    const {
      companyId,
      type,
      content,
      isAnonymous,
      placementYear: rawPlacementYear,
      placementListContext,
      companyVisitId: rawCompanyVisitId,
    } = req.body;

    if (!companyId || !type || !content) {
      return res.status(400).json({ error: messages.ERROR.MISSING_FIELDS });
    }

    const placementYear = normalizeCompanyDetailYear(rawPlacementYear);
    let companyVisitId;
    if (
      rawCompanyVisitId &&
      mongoose.Types.ObjectId.isValid(String(rawCompanyVisitId).trim())
    ) {
      companyVisitId = new mongoose.Types.ObjectId(String(rawCompanyVisitId).trim());
    }

    const newSubmission = new Submission({
      companyId,
      type,
      content,
      placementYear,
      ...(placementListContext ? { placementListContext } : {}),
      ...(companyVisitId ? { companyVisitId } : {}),
      isAnonymous: isAnonymous === true || isAnonymous === 'true',
      submittedBy: {
        name: req.user.username, 
        email: req.user.email,
      }
    });
    const AuthUserModel = getAuthUserModel(req);
    await Promise.all([
      newSubmission.save(),
      AuthUserModel.updateOne(
        { _id: req.user._id },
        { $set: { lastLoginAt: new Date(), lastActiveAt: new Date() } }
      ),
    ]);

    res.status(201).json({ message: messages.SUCCESS.SUBMISSION_RECEIVED });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: messages.ERROR.SAVE_ERROR });
  }
});

export default submissionRouter;
