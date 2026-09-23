import express from "express";
import mongoose from "mongoose";
import authJWT from "../middleware/authJWT.js";
import requireAdmin from "../middleware/requireAdmin.js";
import requirePlatformAdmin from "../middleware/requirePlatformAdmin.js";
import authorize from "../middleware/authorize.js";
import Submission from "../models/Submission.js";
import User1 from "../models/User1.js";
import PaymentOrder from "../models/PaymentOrder.js";
import Entitlement from "../models/Entitlement.js";
import CollegeOnboardingRequest from "../models/CollegeOnboardingRequest.js";
import InterviewSession from "../models/InterviewSession.js";
import PrepPathPlan from "../models/PrepPathPlan.js";
import { mongoMatchPlatformUsers } from "../utils/collegeScope.js";
import {
  listCollegeOnboardingRequests,
  updateCollegeOnboardingRequest,
} from "../services/collegeOnboardingService.js";
import {
  approveSubmissionAndUpdateCompany,
  approveSubmissionsBatch,
  MAX_SUBMISSION_APPROVE_BATCH_SIZE,
} from "../services/submissionApprovalService.js";
import {
  invalidateMySubmissionsCacheByEmail,
  submitterEmailFromSubmission,
} from "../services/mySubmissionsCache.js";
import { invalidateAdminDashboardStatsCache } from "../services/adminDashboardStatsCache.js";
import { invalidateSpcMyRecordsCacheByEmail } from "../services/spcMyRecordsCache.js";
import { dispatchEvent } from "../services/events/eventDispatcher.js";
import { EVENT_TYPES } from "../services/events/eventTypes.js";
import {
  generateSubmissionAnswer,
  isSubmissionAddAnswerSupported,
} from "../services/submissionAnswerService.js";
import {
  assertMergeContentValidForSubmissionType,
  enhanceSubmissionContent,
  isSubmissionEnhancementSupported,
} from "../services/submissionEnhanceService.js";

const router = express.Router();
router.use(authJWT);
router.use(authorize(["admin"]));
router.use(requireAdmin);
router.use(requirePlatformAdmin);

const SUBMISSION_CONTENT_PREVIEW_MAX = 520;
const ADMIN_LIST_DEFAULT_LIMIT = 25;
const ADMIN_LIST_MAX_LIMIT = 100;
const PLATFORM_SUBMISSION_QUERY = { contentScope: "platform" };

function parseAdminPagination(query) {
  const page = Math.max(1, parseInt(String(query?.page || "1"), 10) || 1);
  let limit = parseInt(String(query?.limit || String(ADMIN_LIST_DEFAULT_LIMIT)), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = ADMIN_LIST_DEFAULT_LIMIT;
  limit = Math.min(limit, ADMIN_LIST_MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

function mapSubmissionListRow(doc) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  const full = typeof o.content === "string" ? o.content : "";
  const truncated = full.length > SUBMISSION_CONTENT_PREVIEW_MAX;
  const content = truncated ? `${full.slice(0, SUBMISSION_CONTENT_PREVIEW_MAX)}…` : full;
  return { ...o, content, contentTruncated: truncated };
}

function reviewerFromRequest(req) {
  const reviewerName =
    String(req.user?.username || "").trim() ||
    String(req.user?.email || "")
      .split("@")[0]
      .trim() ||
    "Reviewer";
  return {
    role: "admin",
    name: reviewerName,
    email: String(req.user?.email || "").trim(),
  };
}

async function invalidateSubmitterListCaches(submission) {
  const email = submitterEmailFromSubmission(submission);
  await Promise.all([
    invalidateMySubmissionsCacheByEmail(email),
    invalidateSpcMyRecordsCacheByEmail(email),
  ]);
}

function rejectIfNotPlatformSubmission(submission, res) {
  if (String(submission?.contentScope || "") !== "platform") {
    res.status(403).json({ error: "Submission is not a /general platform contribution." });
    return true;
  }
  return false;
}

router.get("/stats", async (_req, res) => {
  try {
    const now = new Date();
    const [
      totalUsers,
      pendingSubmissions,
      approvedSubmissions,
      onboardingOpen,
      paidOrders,
      activeEntitlements,
      platformMockSessions,
      prepPathPlans,
    ] = await Promise.all([
      User1.countDocuments(mongoMatchPlatformUsers("email")),
      Submission.countDocuments({ ...PLATFORM_SUBMISSION_QUERY, status: "pending" }),
      Submission.countDocuments({ ...PLATFORM_SUBMISSION_QUERY, status: "approved" }),
      CollegeOnboardingRequest.countDocuments({
        status: { $ne: "onboarded" },
      }),
      PaymentOrder.countDocuments({ status: "paid" }),
      Entitlement.countDocuments({ expiresAt: { $gt: now } }),
      InterviewSession.countDocuments({ contentScope: "platform" }),
      PrepPathPlan.countDocuments({}),
    ]);

    return res.json({
      totalUsers,
      pendingSubmissions,
      approvedSubmissions,
      onboardingOpen,
      paidOrders,
      activeEntitlements,
      platformMockSessions,
      prepPathPlans,
    });
  } catch (error) {
    console.error("GET /api/admin/platform/stats:", error?.message || error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/onboarding", async (req, res) => {
  try {
    const data = await listCollegeOnboardingRequests({
      status: req.query?.status,
      page: req.query?.page,
      limit: req.query?.limit,
    });
    return res.json(data);
  } catch (error) {
    console.error("GET /api/admin/platform/onboarding:", error?.message || error);
    return res.status(500).json({ error: "Failed to load onboarding requests" });
  }
});

router.patch("/onboarding/:id", async (req, res) => {
  try {
    const doc = await updateCollegeOnboardingRequest(req.params.id, req.body || {});
    return res.json(doc);
  } catch (error) {
    const code = error?.code;
    if (code === "NOT_FOUND") return res.status(404).json({ error: error.message });
    if (code === "INVALID_STATUS") return res.status(400).json({ error: error.message });
    console.error("PATCH /api/admin/platform/onboarding/:id:", error?.message || error);
    return res.status(500).json({ error: "Failed to update onboarding request" });
  }
});

router.get("/billing/orders", async (req, res) => {
  try {
    const paidQuery = { status: "paid" };
    const [premiumUserIds, paidCount, moneyAgg] = await Promise.all([
      PaymentOrder.distinct("userId", paidQuery),
      PaymentOrder.countDocuments(paidQuery),
      PaymentOrder.aggregate([
        { $match: paidQuery },
        { $group: { _id: null, totalPaise: { $sum: "$amountPaise" } } },
      ]),
    ]);
    const summary = {
      premiumUserCount: premiumUserIds.length,
      totalPlansBought: paidCount,
      totalMoneyPaise: moneyAgg[0]?.totalPaise || 0,
    };

    if (String(req.query?.view || "") === "users") {
      const items = await PaymentOrder.find(paidQuery)
        .select("email userId planId categoryId amountPaise currency createdAt")
        .sort({ createdAt: -1 })
        .lean();
      return res.json({
        items,
        total: items.length,
        ...summary,
      });
    }

    const { page, limit, skip } = parseAdminPagination(req.query);
    const status = String(req.query?.status || "").trim().toLowerCase();
    const query = {};
    if (status === "created" || status === "paid" || status === "failed") {
      query.status = status;
    }
    const [total, items] = await Promise.all([
      PaymentOrder.countDocuments(query),
      PaymentOrder.find(query)
        .select("email userId planId categoryId amountPaise currency createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);
    return res.json({
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      ...summary,
    });
  } catch (error) {
    console.error("GET /api/admin/platform/billing/orders:", error?.message || error);
    return res.status(500).json({ error: "Failed to load billing orders" });
  }
});

router.get("/submissions", async (req, res) => {
  try {
    const { status } = req.query;
    const baseQuery = { ...PLATFORM_SUBMISSION_QUERY };
    if (status) baseQuery.status = status;
    const { page, limit, skip } = parseAdminPagination(req.query);
    const [total, docs] = await Promise.all([
      Submission.countDocuments(baseQuery),
      Submission.find(baseQuery)
        .populate({ path: "companyId", select: "name", model: "CompanyStatic" })
        .select(
          "companyId type submittedBy isAnonymous status submittedAt approvedAt reviewedBy content placementYear contentScope"
        )
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
    ]);
    return res.json({
      items: docs.map(mapSubmissionListRow),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("GET /api/admin/platform/submissions:", error?.message || error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/submissions/:id", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id).populate({
      path: "companyId",
      select: "name",
      model: "CompanyStatic",
    });
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    if (rejectIfNotPlatformSubmission(submission, res)) return;
    return res.json(submission);
  } catch (error) {
    console.error("GET /api/admin/platform/submissions/:id:", error?.message || error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/submissions/:id/enhance", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    if (rejectIfNotPlatformSubmission(submission, res)) return;
    if (submission.status !== "pending") {
      return res.status(400).json({ error: "Only pending submissions can be enhanced." });
    }
    if (!isSubmissionEnhancementSupported(submission.type)) {
      return res.status(400).json({
        error: "AI enhancement is not available for must-do topic submissions.",
      });
    }
    const enhanced = await enhanceSubmissionContent({
      type: submission.type,
      content: submission.content,
    });
    return res.json({ content: enhanced });
  } catch (error) {
    const msg = String(error?.message || error || "Enhancement failed");
    if (msg.includes("Missing GROQ")) {
      return res.status(503).json({ error: "AI enhancement is not configured." });
    }
    return res.status(422).json({ error: msg });
  }
});

router.post("/submissions/:id/add-answer", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id).select(
      "type content status contentScope"
    );
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    if (rejectIfNotPlatformSubmission(submission, res)) return;
    if (submission.status !== "pending") {
      return res.status(400).json({ error: "Only pending submissions can receive a generated answer." });
    }
    if (!isSubmissionAddAnswerSupported(submission.type)) {
      return res.status(400).json({
        error: "Add answer is only available for OA and interview question submissions.",
      });
    }
    const fullContent = typeof submission.content === "string" ? submission.content : "";
    const content = await generateSubmissionAnswer({
      type: submission.type,
      content: fullContent,
    });
    return res.json({ content });
  } catch (error) {
    const msg = String(error?.message || error || "Answer generation failed");
    if (msg.includes("Missing GROQ")) {
      return res.status(503).json({ error: "AI answer generation is not configured." });
    }
    return res.status(422).json({ error: msg });
  }
});

router.post("/submissions/approve-batch", async (req, res) => {
  try {
    const rawIds = req.body?.ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return res.status(400).json({ error: "Request body must include a non-empty ids array." });
    }
    if (rawIds.length > MAX_SUBMISSION_APPROVE_BATCH_SIZE) {
      return res.status(400).json({
        error: `Cannot approve more than ${MAX_SUBMISSION_APPROVE_BATCH_SIZE} submissions per batch.`,
      });
    }
    const objectIds = rawIds
      .map((id) => (mongoose.Types.ObjectId.isValid(String(id)) ? String(id) : null))
      .filter(Boolean);
    const scoped = await Submission.find({
      ...PLATFORM_SUBMISSION_QUERY,
      _id: { $in: objectIds },
    })
      .select("_id")
      .lean();
    const scopedIds = scoped.map((row) => String(row._id));
    if (scopedIds.length === 0) {
      return res.status(403).json({ error: "None of the selected submissions are platform contributions." });
    }
    const summary = await approveSubmissionsBatch(scopedIds, reviewerFromRequest(req));
    return res.json({
      message: `Batch approval finished: ${summary.successCount} succeeded, ${summary.failCount} failed.`,
      ...summary,
    });
  } catch (error) {
    console.error("POST /api/admin/platform/submissions/approve-batch:", error?.message || error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/submissions/:id/approve", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    if (rejectIfNotPlatformSubmission(submission, res)) return;
    if (submission.status !== "pending") {
      return res.status(400).json({ error: "Only pending submissions can be approved." });
    }

    let mergeSource = submission.content;
    if (typeof req.body?.mergeContent === "string") {
      const trimmed = req.body.mergeContent.trim();
      if (trimmed.length > 0) {
        if (!isSubmissionEnhancementSupported(submission.type)) {
          return res.status(400).json({
            error: "AI enhancement is not available for must-do topic submissions.",
          });
        }
        try {
          assertMergeContentValidForSubmissionType(submission.type, trimmed);
          mergeSource = trimmed.slice(0, 70000);
        } catch (error) {
          return res.status(400).json({
            error: String(error?.message || error || "Invalid mergeContent"),
          });
        }
      }
    }

    const result = await approveSubmissionAndUpdateCompany(
      submission,
      mergeSource,
      reviewerFromRequest(req)
    );
    dispatchEvent(EVENT_TYPES.COMPANY_UPDATED, {
      companyId: result.companyId,
      updateKey: String(result.submission?._id || submission._id),
      body: "New content was added for a company you follow. Open the page to see what's new.",
    });
    return res.json({
      message: "Submission approved and company updated successfully",
      submission: result.submission,
      companyId: result.companyId,
    });
  } catch (error) {
    console.error("POST /api/admin/platform/submissions/:id/approve:", error?.message || error);
    return res.status(500).json({ error: "Server error", details: error.message });
  }
});

router.delete("/submissions/:id/reject", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    if (rejectIfNotPlatformSubmission(submission, res)) return;
    await Submission.findByIdAndDelete(req.params.id);
    await invalidateSubmitterListCaches(submission);
    await invalidateAdminDashboardStatsCache();
    return res.json({ message: "Submission rejected and deleted successfully" });
  } catch (error) {
    console.error("DELETE /api/admin/platform/submissions/:id/reject:", error?.message || error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/submissions/:id/delete", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    if (rejectIfNotPlatformSubmission(submission, res)) return;
    if (submission.status !== "approved") {
      return res.status(400).json({ error: "Only approved submissions can be deleted using this endpoint" });
    }
    await Submission.findByIdAndDelete(req.params.id);
    await invalidateSubmitterListCaches(submission);
    await invalidateAdminDashboardStatsCache();
    return res.json({ message: "Approved submission deleted successfully" });
  } catch (error) {
    console.error("DELETE /api/admin/platform/submissions/:id/delete:", error?.message || error);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
