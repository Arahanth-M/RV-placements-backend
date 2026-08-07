import express from "express";
import mongoose from "mongoose";
import Submission from "../models/Submission.js";
import authJWT from "../middleware/authJWT.js";
import checkBetaAccess from "../middleware/checkBetaAccess.js";
import authorize from "../middleware/authorize.js";
import validateRequest from "../middleware/validateRequest.js";
import { submissionInputSchema, submissionUpdateSchema } from "../validations/submission.validation.js";
import { messages } from "../config/constants.js";
import { normalizeCompanyDetailYear } from "../services/companyService.js";
import { getAuthUserModel } from "../utils/authUserModel.js";
import {
  getCachedMySubmissions,
  setCachedMySubmissions,
  invalidateMySubmissionsCacheByEmail,
  normalizeSubmitterEmail,
} from "../services/mySubmissionsCache.js";
import { recordDauActivitySafe } from "../services/dau/recordDauActivity.js";


const submissionRouter = express.Router();
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildMySubmissionsPayload(submissions) {
  return submissions.map((submission) => ({
    _id: submission._id,
    type: submission.type,
    content: submission.content,
    isAnonymous: submission.isAnonymous === true,
    status: submission.status,
    submittedAt: submission.submittedAt,
    approvedAt: submission.approvedAt ?? null,
    reviewedBy: submission.reviewedBy
      ? {
          role: submission.reviewedBy.role ?? null,
          name: submission.reviewedBy.name ?? "",
          email: submission.reviewedBy.email ?? "",
        }
      : null,
    placementYear: submission.placementYear ?? null,
    placementListContext: submission.placementListContext ?? null,
    companyVisitId: submission.companyVisitId
      ? String(submission.companyVisitId)
      : null,
    companyId: submission.companyId?._id || null,
    companyName: submission.companyId?.name || "Unknown company",
  }));
}

submissionRouter.get(
  "/mine",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin", "spc"]),
  async (req, res) => {
    try {
      const email = normalizeSubmitterEmail(req.user?.email);

      if (!email) {
        return res.status(401).json({ error: messages.ERROR.NOT_AUTHENTICATED });
      }

      const cached = await getCachedMySubmissions(email);
      if (cached) {
        return res.json(cached);
      }

      const submissions = await Submission.find({
        "submittedBy.email": {
          $regex: new RegExp(`^${escapeRegex(email)}$`, "i"),
        },
      })
        .sort({ submittedAt: -1, _id: -1 })
        .populate("companyId", "name")
        .lean();

      const responsePayload = { submissions: buildMySubmissionsPayload(submissions) };
      await setCachedMySubmissions(email, responsePayload);

      return res.json(responsePayload);
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
    recordDauActivitySafe(req.user);

    await invalidateMySubmissionsCacheByEmail(req.user?.email);

    res.status(201).json({ message: messages.SUCCESS.SUBMISSION_RECEIVED });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: messages.ERROR.SAVE_ERROR });
  }
});

submissionRouter.put(
  "/:id",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin", "spc"]),
  validateRequest(submissionUpdateSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid submission id" });
      }

      const submission = await Submission.findById(id);
      if (!submission) {
        return res.status(404).json({ error: "Submission not found" });
      }

      const ownerEmail = normalizeSubmitterEmail(submission.submittedBy?.email);
      const sessionEmail = normalizeSubmitterEmail(req.user?.email);
      if (!sessionEmail || ownerEmail !== sessionEmail) {
        return res.status(403).json({ error: "You can only edit your own submissions" });
      }

      if (submission.status !== "pending") {
        return res.status(400).json({ error: "Only pending submissions can be edited" });
      }

      submission.content = req.body.content;
      if (req.body.isAnonymous !== undefined) {
        submission.isAnonymous =
          req.body.isAnonymous === true || req.body.isAnonymous === "true";
      }
      await submission.save();
      await invalidateMySubmissionsCacheByEmail(sessionEmail);
      await submission.populate("companyId", "name");

      return res.json({
        message: "Submission updated",
        submission: {
          _id: submission._id,
          type: submission.type,
          content: submission.content,
          isAnonymous: submission.isAnonymous === true,
          status: submission.status,
          submittedAt: submission.submittedAt,
          placementYear: submission.placementYear ?? null,
          placementListContext: submission.placementListContext ?? null,
          companyVisitId: submission.companyVisitId ? String(submission.companyVisitId) : null,
          companyId: submission.companyId?._id || null,
          companyName: submission.companyId?.name || "Unknown company",
        },
      });
    } catch (error) {
      console.error("Error updating submission:", error);
      return res.status(500).json({ error: "Error updating submission" });
    }
  }
);

submissionRouter.delete(
  "/:id",
  authJWT,
  checkBetaAccess,
  authorize(["student", "admin", "spc"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid submission id" });
      }

      const submission = await Submission.findById(id);
      if (!submission) {
        return res.status(404).json({ error: "Submission not found" });
      }

      const ownerEmail = normalizeSubmitterEmail(submission.submittedBy?.email);
      const sessionEmail = normalizeSubmitterEmail(req.user?.email);
      if (!sessionEmail || ownerEmail !== sessionEmail) {
        return res.status(403).json({ error: "You can only delete your own submissions" });
      }

      if (submission.status !== "pending") {
        return res.status(400).json({ error: "Only pending submissions can be deleted" });
      }

      await Submission.deleteOne({ _id: id });
      await invalidateMySubmissionsCacheByEmail(sessionEmail);
      return res.json({ message: "Submission deleted" });
    } catch (error) {
      console.error("Error deleting submission:", error);
      return res.status(500).json({ error: "Error deleting submission" });
    }
  }
);

export default submissionRouter;
