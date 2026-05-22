import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import XLSX from "xlsx";
import authJWT from "../middleware/authJWT.js";
import authorize from "../middleware/authorize.js";
import requireAdmin from "../middleware/requireAdmin.js";
import requireAdminOrSpc from "../middleware/requireAdminOrSpc.js";
import validateRequest from "../middleware/validateRequest.js";
import {
  adminOaQuestionUpdateSchema,
  adminInterviewQuestionUpdateSchema,
  adminInterviewProcessUpdateSchema,
  adminMustDoTopicUpdateSchema,
  adminCompanyStatsSchema,
  adminCompanyTotalGotInAdjustmentSchema,
  adminCompanyRolesSchema,
  adminCompanyGeneralSchema,
  adminPlacementHubSettingsSchema,
} from "../validations/admin.validation.js";
import {
  getPlacementHubSettingsForApi,
  updatePlacementHubOpenDreamThresholds,
} from "../services/placementHubSettingsService.js";
import User from "../models/User.js";
import User1 from "../models/User1.js";
import Student from "../models/Student.js";
import Submission from "../models/Submission.js";
import CompanyStatic from "../models/CompanyStatic.js";
import CompanyVisit from "../models/CompanyVisit.js";
import Notification from "../models/Notification.js";
import { getAdminStats } from "../controllers/adminStatsController.js";
import { invalidateAdminDashboardStatsCache } from "../services/adminDashboardStatsCache.js";
import {
  invalidateMySubmissionsCacheByEmail,
  submitterEmailFromSubmission,
} from "../services/mySubmissionsCache.js";
import { invalidateSpcMyRecordsCacheByEmail } from "../services/spcMyRecordsCache.js";
import { getStudentPlacementStats } from "../services/studentPlacementStatsCache.js";
import { invalidateCompanyDetailCache } from "../services/companyDetailCache.js";

async function invalidateSubmitterListCaches(submission) {
  const email = submitterEmailFromSubmission(submission);
  await Promise.all([
    invalidateMySubmissionsCacheByEmail(email),
    invalidateSpcMyRecordsCacheByEmail(email),
  ]);
}
import {
  approveAndNormalizeSingleCompanyVisitById,
  adjustVisitTotalGotIn,
  deleteCompanyVisitForYear,
  findOnePendingVisitForCompanyYear,
  mergeToLegacyShape,
  visitRowBelongsToCompanyStatic,
  normalizeRoleStipendFields,
  deleteSplitCompany,
  ensureAdminVisitForYear,
  getCompanyMergedForAdminById,
  listAdminPaginatedCompaniesFromSplit,
  mutateMustDoTopicForCompanyCluster,
  normalizeCompanyDetailYear,
  persistMergedCompany,
  updateCompanyStatic,
  updateCompanyVisit,
} from "../services/companyService.js";
import { invalidateLeaderboardCache } from "./leaderboardRoutes.js";
import { dispatchEvent } from "../services/events/eventDispatcher.js";
import { EVENT_TYPES } from "../services/events/eventTypes.js";
import { PPO_BRANCH_CODES, PPO_BRANCH_CODES_ARRAY } from "../utils/ppoBranchCodes.js";
import {
  importStudentsFromXlsxBuffer,
  STUDENT_BATCH_COLUMN_GUIDE,
} from "../services/studentBatchImportService.js";
import {
  generateSubmissionAnswer,
  isSubmissionAddAnswerSupported,
} from "../services/submissionAnswerService.js";
import {
  assertMergeContentValidForSubmissionType,
  enhanceSubmissionContent,
  isSubmissionEnhancementSupported,
} from "../services/submissionEnhanceService.js";

const adminRouter = express.Router();

const submissionModRouter = express.Router();

const studentBatchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const nameOk = /\.xlsx$/i.test(file.originalname || "");
    const mimeOk =
      file.mimetype ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (nameOk || mimeOk) cb(null, true);
    else cb(new Error("Only .xlsx spreadsheets are allowed."));
  },
});

// JWT first; submission moderation allows admin session OR SPC; everything else admin-only
adminRouter.use(authJWT);
submissionModRouter.use(authorize(["admin", "spc"]));
submissionModRouter.use(requireAdminOrSpc);
adminRouter.use(submissionModRouter);
adminRouter.use(authorize(["admin"]));
adminRouter.use(requireAdmin);

adminRouter.get("/students/batch-import/column-guide", (_req, res) => {
  res.json({ columns: STUDENT_BATCH_COLUMN_GUIDE });
});

adminRouter.post(
  "/students/batch-import",
  (req, res, next) => {
    studentBatchUpload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          error: err.message || "Upload failed",
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded. Use the form field name "file".',
        });
      }
      const result = await importStudentsFromXlsxBuffer(req.file.buffer, Student);
      if (!result.success) {
        const status = result.code === "TRANSACTIONS_NOT_SUPPORTED" ? 503 : 400;
        return res.status(status).json(result);
      }
      return res.json(result);
    } catch (error) {
      console.error("❌ Admin student batch import:", error?.message || error);
      return res.status(500).json({
        success: false,
        error: "Server error during import",
      });
    }
  }
);

/** Placement year for admin visit reads/writes (`?year=2026|2027`, default 2026). */
function adminVisitYearFromQuery(req) {
  return normalizeCompanyDetailYear(req.query?.year);
}

/** Same hub / row resolution as public company detail (`?placementContext=` + optional `companyVisitId=`). */
function adminStatsVisitResolutionArgs(req) {
  const placementCtxRaw = req.query?.placementContext;
  const placementListContext =
    placementCtxRaw != null && String(placementCtxRaw).trim() !== ""
      ? String(placementCtxRaw).trim()
      : null;
  const vidRaw = req.query?.companyVisitId;
  const companyVisitIdHint =
    vidRaw != null && String(vidRaw).trim() !== "" ? String(vidRaw).trim() : null;
  return { placementListContext, companyVisitIdHint };
}

/** Placement-year filter for admin company listing (`?year=2026|2027|all`). */
function adminCompanyListYearFromQuery(req) {
  const raw = req.query?.year;
  if (raw == null || raw === "" || String(raw).toLowerCase() === "all") {
    return null;
  }
  return normalizeCompanyDetailYear(raw);
}

function projectAdminCompanyListRow(merged, status) {
  if (status === "approved") {
    return {
      _id: merged._id,
      name: merged.name,
      type: merged.type,
      offCampus: merged.offCampus,
      status: merged.status,
      count: merged.count,
      createdAt: merged.createdAt,
      updatedAt: merged.updatedAt,
      approvedAt: merged.approvedAt,
      submittedBy: merged.submittedBy,
      placementYear: merged.placementYear ?? null,
      companyVisitId: merged.companyVisitId ?? null,
    };
  }
  if (status === "pending") {
    /** Same minimal shape as approved: OA / interview / must-do live under Submissions, not here. */
    return {
      _id: merged._id,
      name: merged.name,
      type: merged.type,
      offCampus: merged.offCampus,
      status: merged.status,
      count: merged.count,
      createdAt: merged.createdAt,
      updatedAt: merged.updatedAt,
      submittedBy: merged.submittedBy,
      placementYear: merged.placementYear ?? null,
      companyVisitId: merged.companyVisitId ?? null,
    };
  }
  return {
    _id: merged._id,
    name: merged.name,
    type: merged.type,
    status: merged.status,
    count: merged.count,
    createdAt: merged.createdAt,
    updatedAt: merged.updatedAt,
    placementYear: merged.placementYear ?? null,
    companyVisitId: merged.companyVisitId ?? null,
  };
}

/** Avoid 500 when res.json stringifies values Mongoose/JSON dislikes (BigInt in Mixed, circular refs, etc.). */
function companyToJsonSafePlainObject(doc) {
  let plain = doc;
  try {
    if (doc && typeof doc.toObject === "function") {
      plain = doc.toObject({ flattenMaps: true });
    }
  } catch (e) {
    console.error("❌ company JSON: toObject failed:", e?.message || e);
    plain = { _id: doc?._id, name: doc?.name, status: doc?.status, approvedAt: doc?.approvedAt };
  }
  const bigintReplacer = (_k, v) => (typeof v === "bigint" ? v.toString() : v);
  try {
    return JSON.parse(JSON.stringify(plain, bigintReplacer));
  } catch (serializeErr) {
    console.error("❌ company JSON: serialize failed:", serializeErr?.message || serializeErr);
    const minimal = {
      _id: plain?._id,
      name: plain?.name,
      status: plain?.status,
      approvedAt: plain?.approvedAt,
    };
    return JSON.parse(JSON.stringify(minimal, bigintReplacer));
  }
}

// Sanitize text for company content (remove script tags; keep other text as-is)
function sanitizeText(text) {
  if (text === undefined || text === null) return '';
  let str = String(text);
  // Strip out dangerous HTML/script tags while preserving code-like angle brackets
  // such as vector<int> or #include<stdio.h>.
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  str = str.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  str = str.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  str = str.replace(/<\/?\s*(?:script|style|iframe|object|embed|form|svg|link|meta|base|body|html|head|img|video|audio|source|input|button|textarea|select|option|noscript)\b[^>]*>/gi, '');
  str = str.replace(/\s+on[a-z][\w-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  str = str.replace(/(?<![/:])\bjavascript\s*:[^\s"'<>]*/gi, '');
  str = str.replace(/(?<![/:])\bdata\s*:[^\s"'<>]*/gi, '');
  return str.trim();
}

// Get total number of users
adminRouter.get("/stats/users", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    res.json({ totalUsers });
  } catch (error) {
    console.error("❌ Error fetching user count:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Branch-wise placed students grouped by placement year (admin-only)
adminRouter.get("/students/placement-stats", async (req, res) => {
  try {
    const data = await getStudentPlacementStats(req.query?.year);
    return res.json(data);
  } catch (error) {
    if (error?.message === "INVALID_YEAR") {
      return res.status(400).json({ error: "year must be a valid number" });
    }
    console.error("❌ Error fetching placement student stats:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
});

adminRouter.get("/students/placement-stats/export", async (req, res) => {
  try {
    const data = await getStudentPlacementStats(req.query?.year);
    const workbook = XLSX.utils.book_new();

    for (const branch of data.branches) {
      const rows = (Array.isArray(branch.students) ? branch.students : []).map(
        (student) => ({
          Name: student.name || "",
          USN: student.usn || "",
          "Email ID": student.email || "",
          "Company Placed": student.companyPlaced || "",
          "Type of Offer": student.typeOfOffer || "",
          Stipend: student.stipend || "",
          "6 Months Internship Stipend": student.sixMonthsInternshipStipend || "",
          CTC: student.ctc || "",
          Role: student.role || "",
          "PPO Conversion Type": student.ppoConversionType || "",
          "Added By": student.addedByEmail || "",
        })
      );
      const ws = XLSX.utils.json_to_sheet(rows);
      const sheetName =
        String(branch.branchCode || "unknown")
          .toUpperCase()
          .replace(/[\\/?*[\]:]/g, "-")
          .slice(0, 31) || "UNKNOWN";
      XLSX.utils.book_append_sheet(workbook, ws, sheetName);
    }

    if (workbook.SheetNames.length === 0) {
      const ws = XLSX.utils.json_to_sheet([]);
      XLSX.utils.book_append_sheet(workbook, ws, "NO_DATA");
    }

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const yearLabel = data.selectedYear != null ? data.selectedYear : "all";
    const fileName = `student-placement-stats-${yearLabel}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  } catch (error) {
    if (error?.message === "INVALID_YEAR") {
      return res.status(400).json({ error: "year must be a valid number" });
    }
    console.error("❌ Error fetching placement student stats:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// Assign SPC role to an existing user (admin-only via router middleware)
adminRouter.post("/assign-spc", async (req, res) => {
  try {
    const normalizedEmail = String(req.body?.email || "").trim().toLowerCase();
    const normalizedUsn = String(req.body?.usn || "").trim().toUpperCase();

    if (!normalizedEmail) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!normalizedUsn) {
      return res.status(400).json({ error: "USN is required" });
    }

    const studentRecord = await Student.findOne({
      email: normalizedEmail,
      usn: normalizedUsn,
    }).select("_id email usn name");

    if (!studentRecord) {
      return res.status(404).json({ error: "Student not found for the provided email and USN" });
    }

    const usernameFallback =
      String(studentRecord?.name || "").trim() ||
      normalizedEmail.split("@")[0] ||
      "student";
    const user = await User1.findOneAndUpdate(
      { email: normalizedEmail },
      {
        $set: {
          username: usernameFallback,
          role: "spc",
        },
        $setOnInsert: {
          profilePicture: "",
          points: 0,
          lastLoginAt: new Date(),
        },
      },
      {
        new: true,
        upsert: true,
      }
    );

    return res.json({
      message: "SPC role assigned successfully",
      user: {
        _id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
      student: {
        email: normalizedEmail,
        usn: normalizedUsn,
      },
    });
  } catch (error) {
    console.error("❌ Error assigning SPC role:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
});

adminRouter.get("/spcs", async (req, res) => {
  try {
    const spcs = await User1.find({ role: "spc" })
      .select("_id username email profilePicture role createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ items: spcs });
  } catch (error) {
    console.error("❌ Error fetching SPC users:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
});

adminRouter.patch("/spcs/:id/revoke", async (req, res) => {
  try {
    const user = await User1.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role !== "spc") {
      return res.status(400).json({ error: "User is not currently an SPC" });
    }

    user.role = "student";
    await user.save();

    return res.json({
      message: "SPC access revoked successfully",
      user: {
        _id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("❌ Error revoking SPC access:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
});

const SUBMISSION_CONTENT_PREVIEW_MAX = 520;
const ADMIN_LIST_DEFAULT_LIMIT = 25;
const ADMIN_LIST_MAX_LIMIT = 100;

function parseAdminPagination(query) {
  const page = Math.max(1, parseInt(String(query.page || "1"), 10) || 1);
  let limit = parseInt(String(query.limit || String(ADMIN_LIST_DEFAULT_LIMIT)), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = ADMIN_LIST_DEFAULT_LIMIT;
  limit = Math.min(limit, ADMIN_LIST_MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

function mapSubmissionListRow(doc) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  const full = typeof o.content === "string" ? o.content : "";
  const truncated = full.length > SUBMISSION_CONTENT_PREVIEW_MAX;
  const content = truncated
    ? `${full.slice(0, SUBMISSION_CONTENT_PREVIEW_MAX)}…`
    : full;
  return { ...o, content, contentTruncated: truncated };
}

async function enrichSubmissionVisitMeta(docs) {
  const visitIds = [
    ...new Set(
      (docs || [])
        .map((doc) => {
          const raw = doc?.companyVisitId;
          const id = raw ? String(raw).trim() : "";
          return mongoose.Types.ObjectId.isValid(id) ? id : null;
        })
        .filter(Boolean)
    ),
  ];
  if (visitIds.length === 0) {
    return docs.map((doc) => {
      const o = doc.toObject ? doc.toObject() : { ...doc };
      return {
        ...o,
        placementYear: o.placementYear ?? null,
        cluster: null,
      };
    });
  }

  const visits = await CompanyVisit.find({
    _id: { $in: visitIds.map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select("_id year cluster")
    .lean();
  const visitById = new Map(
    visits.map((visit) => [String(visit._id), visit])
  );

  return docs.map((doc) => {
    const o = doc.toObject ? doc.toObject() : { ...doc };
    const visit = o.companyVisitId
      ? visitById.get(String(o.companyVisitId))
      : null;
    return {
      ...o,
      placementYear: o.placementYear ?? visit?.year ?? null,
      cluster:
        visit?.cluster != null && String(visit.cluster).trim() !== ""
          ? String(visit.cluster).trim()
          : null,
    };
  });
}

// Paginated submissions list (trimmed content for table rows; use GET /submissions/:id for full body)
submissionModRouter.get("/submissions", async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const { page, limit, skip } = parseAdminPagination(req.query);

    const [total, docs] = await Promise.all([
      Submission.countDocuments(query),
      Submission.find(query)
        .populate({ path: "companyId", select: "name", model: "CompanyStatic" })
        .select(
          "companyId type submittedBy isAnonymous status submittedAt approvedAt reviewedBy content placementYear placementListContext companyVisitId"
        )
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
    ]);

    const enrichedDocs = await enrichSubmissionVisitMeta(docs);
    const items = enrichedDocs.map(mapSubmissionListRow);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      items,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (error) {
    console.error("❌ Error fetching submissions:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Full submission (e.g. admin modal)
submissionModRouter.get("/submissions/:id", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id).populate({ path: "companyId", select: "name", model: "CompanyStatic" });
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    const [enrichedSubmission] = await enrichSubmissionVisitMeta([submission]);
    res.json(enrichedSubmission);
  } catch (error) {
    console.error("❌ Error fetching submission:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Get dashboard stats (Redis-cached when REDIS_URL is set; invalidated on admin mutations)
adminRouter.get("/stats", getAdminStats);

adminRouter.get("/placement-hub-settings", async (_req, res) => {
  try {
    const settings = await getPlacementHubSettingsForApi();
    return res.json(settings);
  } catch (err) {
    console.error("GET /api/admin/placement-hub-settings:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

adminRouter.put(
  "/placement-hub-settings",
  validateRequest(adminPlacementHubSettingsSchema),
  async (req, res) => {
    try {
      const openDreamMinLpaByYear = await updatePlacementHubOpenDreamThresholds(
        req.body.openDreamMinLpaByYear
      );
      return res.json({ openDreamMinLpaByYear });
    } catch (err) {
      console.error("PUT /api/admin/placement-hub-settings:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

// AI polish for SPC/admin review — does not write to the database.
submissionModRouter.post("/submissions/:id/enhance", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
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
    if (msg.includes("Missing GROQ_KEY_") || msg.includes("Missing GROQ_API_KEY") || msg.includes("Missing Groq API key")) {
      return res.status(503).json({ error: "AI enhancement is not configured (missing GROQ_KEY_ADMIN)." });
    }
    console.error("❌ submission enhance:", msg);
    return res.status(422).json({ error: msg });
  }
});

// AI-generated answer for OA / interview questions — does not write to the database.
submissionModRouter.post("/submissions/:id/add-answer", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id).select("type content status");
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
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
    if (msg.includes("Missing GROQ_KEY_") || msg.includes("Missing GROQ_API_KEY") || msg.includes("Missing Groq API key")) {
      return res.status(503).json({ error: "AI answer generation is not configured (missing GROQ_KEY_ADMIN)." });
    }
    console.error("❌ submission add-answer:", msg);
    return res.status(422).json({ error: msg });
  }
});

// Approve submission and update company
submissionModRouter.post("/submissions/:id/approve", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
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
        } catch (e) {
          return res.status(400).json({
            error: String(e?.message || e || "Invalid mergeContent"),
          });
        }
      }
    }

    const placementYear = normalizeCompanyDetailYear(submission.placementYear);
    const placementListContextRaw = submission.placementListContext;
    const placementListContext =
      placementListContextRaw != null && String(placementListContextRaw).trim() !== ""
        ? String(placementListContextRaw).trim()
        : null;

    const companyVisitIdHint = submission.companyVisitId ?? null;

    await ensureAdminVisitForYear(submission.companyId, placementYear);
    const loadedForSub = await getCompanyMergedForAdminById(
      String(submission.companyId),
      placementYear,
      placementListContext,
      companyVisitIdHint
    );
    if (!loadedForSub?.staticRow || !loadedForSub.merged) {
      return res.status(404).json({ error: "Company not found" });
    }
    let merged = JSON.parse(JSON.stringify(loadedForSub.merged));

    const removeLegacySolutionField = () => {
      const legacyKeys = ["onlineQuestion_solution", "onlineQuestion_solutions"];
      legacyKeys.forEach((key) => {
        if (key in merged) delete merged[key];
      });
    };

    const legacySolutions = merged["onlineQuestion_solution"];
    if (
      (!merged.onlineQuestions_solution || merged.onlineQuestions_solution.length === 0) &&
      Array.isArray(legacySolutions) &&
      legacySolutions.length > 0
    ) {
      merged.onlineQuestions_solution = legacySolutions;
    }
    removeLegacySolutionField();

    // Parse submission content (optional mergeContent from body = AI-enhanced text, not persisted on Submission)
    let parsedContent;
    try {
      parsedContent = JSON.parse(mergeSource);
    } catch {
      parsedContent = { question: mergeSource, solution: "" };
    }

    // Update company based on submission type
    if (submission.type === "onlineQuestions") {
      // Ensure we get a string value
      let questionText = parsedContent.question || mergeSource;
      if (questionText && typeof questionText !== 'string') {
        questionText = String(questionText);
      }
      if (questionText) {
        // Initialize arrays if they don't exist
        if (!merged.onlineQuestions) {
          merged.onlineQuestions = [];
        }
        if (!merged.onlineQuestions_solution) {
          merged.onlineQuestions_solution = [];
        }
        const ensureSolutionArraySync = () => {
          while (merged.onlineQuestions_solution.length < merged.onlineQuestions.length) {
            merged.onlineQuestions_solution.push("");
          }
        };
        
        const sanitizedQuestion = sanitizeText(questionText);
        
        if (sanitizedQuestion.length > 0) {
          const existingIndex = merged.onlineQuestions.findIndex(
            (q) => typeof q === "string" && q.trim() === sanitizedQuestion.trim()
          );

          const getSanitizedSolution = () => {
            if (!parsedContent.solution) return "";
            return sanitizeText(parsedContent.solution);
          };

          if (existingIndex === -1) {
            merged.onlineQuestions.push(sanitizedQuestion);

            ensureSolutionArraySync();
            const newIndex = merged.onlineQuestions.length - 1;

            const sanitizedSolution = getSanitizedSolution();
            merged.onlineQuestions_solution[newIndex] = sanitizedSolution || "";
            
            console.log('✅ Added online question to company:', merged._id);
          } else {
            console.log('ℹ️ Question already exists, updating solution text');
            ensureSolutionArraySync();
            const sanitizedSolution = getSanitizedSolution();
            if (sanitizedSolution) {
              const existingSolution = merged.onlineQuestions_solution[existingIndex] || "";
              const combined = existingSolution
                ? `${existingSolution}\n\n${sanitizedSolution}`
                : sanitizedSolution;
              merged.onlineQuestions_solution[existingIndex] = combined;
            } else if (
              !merged.onlineQuestions_solution[existingIndex] ||
              typeof merged.onlineQuestions_solution[existingIndex] !== "string"
            ) {
              merged.onlineQuestions_solution[existingIndex] = "";
            }
          }
        } else {
          console.warn(`Question truncated but still exceeds limit: ${truncatedQuestion?.length || 0} chars`);
        }
      }
    } else if (submission.type === "interviewQuestions") {
      // Ensure we get a string value
      let questionText = parsedContent.question || mergeSource;
      if (questionText && typeof questionText !== 'string') {
        questionText = String(questionText);
      }
      if (questionText) {
        // Initialize arrays if they don't exist
        if (!merged.interviewQuestions) {
          merged.interviewQuestions = [];
        }
        if (!merged.interviewQuestions_solution) {
          merged.interviewQuestions_solution = [];
        }
        const ensureSolutionArraySync = () => {
          while (merged.interviewQuestions_solution.length < merged.interviewQuestions.length) {
            merged.interviewQuestions_solution.push("");
          }
        };
        
        const sanitizedQuestion = sanitizeText(questionText);
        
        if (sanitizedQuestion.length > 0) {
          const existingIndex = merged.interviewQuestions.findIndex(
            (q) => typeof q === "string" && q.trim() === sanitizedQuestion.trim()
          );

          const getSanitizedSolution = () => {
            if (!parsedContent.solution) return "";
            return sanitizeText(parsedContent.solution);
          };

          if (existingIndex === -1) {
            merged.interviewQuestions.push(sanitizedQuestion);

            ensureSolutionArraySync();
            const newIndex = merged.interviewQuestions.length - 1;

            const sanitizedSolution = getSanitizedSolution();
            merged.interviewQuestions_solution[newIndex] = sanitizedSolution || "";
            
            console.log('✅ Added interview question to company:', merged._id);
          } else {
            console.log('ℹ️ Question already exists, updating solution text');
            ensureSolutionArraySync();
            const sanitizedSolution = getSanitizedSolution();
            if (sanitizedSolution) {
              const existingSolution = merged.interviewQuestions_solution[existingIndex] || "";
              const combined = existingSolution
                ? `${existingSolution}\n\n${sanitizedSolution}`
                : sanitizedSolution;
              merged.interviewQuestions_solution[existingIndex] = combined;
            } else if (
              !merged.interviewQuestions_solution[existingIndex] ||
              typeof merged.interviewQuestions_solution[existingIndex] !== "string"
            ) {
              merged.interviewQuestions_solution[existingIndex] = "";
            }
          }
        }
      }
    } else if (submission.type === "interviewProcess") {
      // Ensure we get a string value
      let processText = parsedContent.question || parsedContent.content || mergeSource;
      if (processText && typeof processText !== 'string') {
        processText = String(processText);
      }
      if (processText) {
        const sanitizedProcess = sanitizeText(processText);
        if (sanitizedProcess.length > 0) {
          // Initialize array if it doesn't exist
          if (!merged.interviewProcess || !Array.isArray(merged.interviewProcess)) {
            merged.interviewProcess = [];
          }
          
          // Check if this process already exists (compare content)
          // Handle both legacy string format and new JSON string format
          const processExists = merged.interviewProcess.some(process => {
            try {
              // Try to parse as JSON (new format with metadata)
              const parsed = JSON.parse(process);
              if (parsed && typeof parsed === 'object' && parsed.content) {
                return parsed.content === sanitizedProcess;
              }
            } catch {
              // Not JSON, treat as legacy string
            }
            // Legacy string format - direct comparison
            return process === sanitizedProcess;
          });
          
          if (!processExists) {
            // Store as JSON string to preserve submitter info while keeping String type in schema
            const processEntry = JSON.stringify({
              content: sanitizedProcess,
              submittedBy: {
                name: submission.submittedBy.name,
                email: submission.submittedBy.email
              },
              isAnonymous: submission.isAnonymous === true || submission.isAnonymous === 'true'
            });
            merged.interviewProcess.push(processEntry);
            console.log('✅ Added interview process to company:', merged._id);
          } else {
            console.log('⚠️ Interview process already exists in company');
          }
        }
      }
    } else if (submission.type === "internshipExperience") {
      let experienceText =
        parsedContent.experience || parsedContent.content || mergeSource;
      if (experienceText && typeof experienceText !== "string") {
        experienceText = String(experienceText);
      }
      if (experienceText) {
        const sanitizedExperience = sanitizeText(experienceText);
        if (sanitizedExperience.length > 0) {
          if (!merged.internshipExperience || !Array.isArray(merged.internshipExperience)) {
            merged.internshipExperience = [];
          }

          const experienceExists = merged.internshipExperience.some((exp) => {
            try {
              const parsed = JSON.parse(exp);
              if (parsed && typeof parsed === "object") {
                const existingContent = parsed.content || parsed.experience || "";
                return String(existingContent).trim() === sanitizedExperience;
              }
            } catch {
              // Legacy plain-string format.
            }
            return String(exp || "").trim() === sanitizedExperience;
          });

          if (!experienceExists) {
            const experienceEntry = JSON.stringify({
              content: sanitizedExperience,
              submittedBy: {
                name: submission.submittedBy.name,
                email: submission.submittedBy.email,
              },
              isAnonymous:
                submission.isAnonymous === true || submission.isAnonymous === "true",
            });
            merged.internshipExperience.push(experienceEntry);
            console.log("✅ Added internship experience to company:", merged._id);
          } else {
            console.log("⚠️ Internship experience already exists in company");
          }
        }
      }
    } else if (submission.type === "mustDoTopics") {
      // Ensure we get a string value
      let topicText = parsedContent.question || parsedContent.content || parsedContent.topic || mergeSource;
      if (topicText && typeof topicText !== 'string') {
        topicText = String(topicText);
      }
      if (topicText) {
        const sanitizedTopic = sanitizeText(topicText);
        if (sanitizedTopic.length > 0) {
          // Initialize array if it doesn't exist
          if (!merged.Must_Do_Topics || !Array.isArray(merged.Must_Do_Topics)) {
            merged.Must_Do_Topics = [];
          }
          
          // Append the new topic to the array (avoid duplicates)
          if (!merged.Must_Do_Topics.includes(sanitizedTopic)) {
            merged.Must_Do_Topics.push(sanitizedTopic);
            console.log('✅ Added must do topic to company:', merged._id);
          } else {
            console.log('⚠️ Must do topic already exists in company');
          }
        }
      }
    }

    // Final validation: ensure all array values don't exceed their max lengths
    // Also filter out empty strings that might cause validation issues
    if (merged.onlineQuestions) {
      merged.onlineQuestions = merged.onlineQuestions
        .map((q) => sanitizeText(q))
        .filter((q) => q && q.length > 0);
    }
    if (merged.onlineQuestions_solution) {
      merged.onlineQuestions_solution = merged.onlineQuestions_solution.map((s) => sanitizeText(s));
    }
    if (merged.interviewQuestions) {
      merged.interviewQuestions = merged.interviewQuestions
        .map((q) => sanitizeText(q))
        .filter((q) => q && q.length > 0);
    }
    if (merged.interviewQuestions_solution) {
      merged.interviewQuestions_solution = merged.interviewQuestions_solution.map((s) => sanitizeText(s));
    }
    if (merged.interviewProcess) {
      // Handle both array and legacy string format
      if (Array.isArray(merged.interviewProcess)) {
        merged.interviewProcess = merged.interviewProcess
          .map((p) => sanitizeText(p))
          .filter((p) => p && p.length > 0);
      } else if (typeof merged.interviewProcess === 'string') {
        // Convert legacy string to array
        const sanitized = sanitizeText(merged.interviewProcess);
        if (sanitized && sanitized.length > 0) {
          merged.interviewProcess = [sanitized];
        }
      }
    }
    if (merged.internshipExperience) {
      if (Array.isArray(merged.internshipExperience)) {
        merged.internshipExperience = merged.internshipExperience
          .map((exp) => sanitizeText(exp))
          .filter((exp) => exp && exp.length > 0);
      } else if (typeof merged.internshipExperience === "string") {
        const sanitized = sanitizeText(merged.internshipExperience);
        if (sanitized && sanitized.length > 0) {
          merged.internshipExperience = [sanitized];
        }
      }
    }
    
    // Truncate Must_Do_Topics to max 200 characters
    if (merged.Must_Do_Topics && Array.isArray(merged.Must_Do_Topics)) {
      merged.Must_Do_Topics = merged.Must_Do_Topics.map(topic => {
        if (typeof topic === 'string' && topic.length > 200) {
          return topic.substring(0, 200);
        }
        return topic || '';
      }).filter(topic => topic && topic.trim().length > 0);
    }
    
    // Truncate mcqQuestions fields to their max lengths
    // Convert to plain objects first to ensure Mongoose recognizes changes
    if (merged.mcqQuestions && Array.isArray(merged.mcqQuestions)) {
      merged.mcqQuestions = merged.mcqQuestions.map((mcq, index) => {
        if (!mcq || typeof mcq !== 'object') return mcq;
        
        // Convert to plain object if it's a Mongoose subdocument
        const plainMcq = mcq.toObject ? mcq.toObject() : { ...mcq };
        const truncatedMcq = {};
        
        // Copy all fields first
        Object.keys(plainMcq).forEach(key => {
          truncatedMcq[key] = plainMcq[key];
        });
        
        // Question max 300
        if (typeof truncatedMcq.question === 'string') {
          if (truncatedMcq.question.length > 300) {
            console.log(`⚠️ Truncating mcqQuestions[${index}].question from ${truncatedMcq.question.length} to 300`);
            truncatedMcq.question = truncatedMcq.question.substring(0, 300);
          }
        }
        
        // Options max 100 each
        ['optionA', 'optionB', 'optionC', 'optionD', 'answer'].forEach(field => {
          if (typeof truncatedMcq[field] === 'string') {
            if (truncatedMcq[field].length > 100) {
              console.log(`⚠️ Truncating mcqQuestions[${index}].${field} from ${truncatedMcq[field].length} to 100`);
              truncatedMcq[field] = truncatedMcq[field].substring(0, 100);
            }
          }
        });
        
        // Final safety check - ensure no field exceeds limits
        if (truncatedMcq.question && truncatedMcq.question.length > 300) {
          truncatedMcq.question = truncatedMcq.question.substring(0, 300);
        }
        ['optionA', 'optionB', 'optionC', 'optionD', 'answer'].forEach(field => {
          if (truncatedMcq[field] && truncatedMcq[field].length > 100) {
            truncatedMcq[field] = truncatedMcq[field].substring(0, 100);
          }
        });
        
        return truncatedMcq;
      });
      
      // Mark as modified
      
      // Final verification pass - double check all lengths
      merged.mcqQuestions.forEach((mcq, index) => {
        if (mcq && typeof mcq === 'object') {
          if (mcq.question && typeof mcq.question === 'string' && mcq.question.length > 300) {
            console.error(`❌ FINAL CHECK FAILED: mcqQuestions[${index}].question still ${mcq.question.length} chars`);
            mcq.question = mcq.question.substring(0, 300);
          }
          ['optionA', 'optionB', 'optionC', 'optionD', 'answer'].forEach(field => {
            if (mcq[field] && typeof mcq[field] === 'string' && mcq[field].length > 100) {
              console.error(`❌ FINAL CHECK FAILED: mcqQuestions[${index}].${field} still ${mcq[field].length} chars`);
              mcq[field] = mcq[field].substring(0, 100);
            }
          });
        }
      });
      
      // Mark again after final verification
    }
    
    // Truncate other string fields with maxlength constraints
    if (merged.eligibility && typeof merged.eligibility === 'string' && merged.eligibility.length > 500) {
      merged.eligibility = merged.eligibility.substring(0, 500);
    }
    if (merged.business_model && typeof merged.business_model === 'string' && merged.business_model.length > 100) {
      merged.business_model = merged.business_model.substring(0, 100);
    }
    
    // Truncate jobDescription fields
    if (merged.jobDescription && Array.isArray(merged.jobDescription)) {
      merged.jobDescription = merged.jobDescription.map(jd => {
        if (jd && typeof jd === 'object') {
          const truncatedJd = { ...jd };
          // Title max 100
          if (typeof truncatedJd.title === 'string' && truncatedJd.title.length > 100) {
            truncatedJd.title = truncatedJd.title.substring(0, 100);
          }
          return truncatedJd;
        }
        return jd;
      });
    }

    // Persist to companies + company_visits (replaces single Company / companies1 save)
    try {
      console.log("📊 Company data before persist:");
      if (merged.mcqQuestions) {
        merged.mcqQuestions.forEach((mcq, idx) => {
          if (mcq && typeof mcq === "object") {
            console.log(`  mcqQuestions[${idx}]:`, {
              questionLength: mcq.question?.length || 0,
              optionALength: mcq.optionA?.length || 0,
              optionBLength: mcq.optionB?.length || 0,
              optionCLength: mcq.optionC?.length || 0,
              optionDLength: mcq.optionD?.length || 0,
            });
          }
        });
      }
      await persistMergedCompany(
        String(submission.companyId),
        merged,
        placementYear,
        placementListContext,
        companyVisitIdHint
      );
      console.log("✅ Company updated successfully:", submission.companyId);

      const afterPersist = await getCompanyMergedForAdminById(
        String(submission.companyId),
        placementYear,
        placementListContext,
        companyVisitIdHint
      );
      const visitIdAfter = afterPersist?.visit?._id;
      if (visitIdAfter) {
        const visitApprovedAt = new Date();
        await approveAndNormalizeSingleCompanyVisitById(
          visitIdAfter,
          visitApprovedAt,
          String(submission.companyId)
        );
      } else {
        console.warn(
          "⚠️ Submission approved but no company_visits row found to normalize/approve for company",
          submission.companyId
        );
      }
    } catch (saveError) {
      console.error("❌ Error persisting company:", saveError);
      console.error("❌ Error details:", {
        name: saveError.name,
        message: saveError.message,
        errors: saveError.errors,
      });
      if (saveError.errors) {
        Object.keys(saveError.errors).forEach((key) => {
          console.error(`❌ Validation error for ${key}:`, saveError.errors[key].message);
        });
      }
      if (saveError.name === "ValidationError") {
        const errors = {};
        Object.keys(saveError.errors || {}).forEach((key) => {
          errors[key] = saveError.errors[key].message;
        });
        return res.status(400).json({
          error: "Validation failed",
          details: errors,
          message: saveError.message,
        });
      }
      throw saveError;
    }

    // Mark submission as approved instead of deleting
    submission.status = "approved";
    submission.approvedAt = new Date();
    const reviewerRole =
      req.user?.isAdminSession === true
        ? "admin"
        : req.user?.role === "spc"
          ? "spc"
          : "admin";
    const reviewerName =
      String(req.user?.username || "").trim() ||
      String(req.user?.email || "")
        .split("@")[0]
        .trim() ||
      "Reviewer";
    submission.reviewedBy = {
      role: reviewerRole,
      name: reviewerName,
      email: String(req.user?.email || "").trim(),
    };
    await submission.save();
    await invalidateSubmitterListCaches(submission);

    // Award leaderboard points: question = 5, interview experience = 10
    const POINTS_QUESTION = 5;
    const POINTS_INTERVIEW_EXPERIENCE = 10;
    const pointsToAdd =
      submission.type === "interviewProcess"
        ? POINTS_INTERVIEW_EXPERIENCE
        : POINTS_QUESTION; // onlineQuestions, interviewQuestions, mustDoTopics

    const contributor =
      (await User1.findOne({ email: submission.submittedBy?.email })) || null;
    if (contributor) {
      contributor.points = (contributor.points || 0) + pointsToAdd;
      await contributor.save();
      try {
        await invalidateLeaderboardCache();
      } catch (cacheErr) {
        console.warn("⚠️ Failed to invalidate leaderboard cache after approval:", cacheErr?.message || cacheErr);
      }
    }

    await invalidateAdminDashboardStatsCache();

    const reloadedSub = await getCompanyMergedForAdminById(
      String(submission.companyId),
      placementYear,
      placementListContext,
      companyVisitIdHint
    );
    const companyOut = reloadedSub?.merged
      ? companyToJsonSafePlainObject(reloadedSub.merged)
      : null;

    // In-app notifications are sent only when a company visit is approved from the
    // Admin Dashboard Companies tab (`POST /companies/:id/approve`), not when
    // approving individual content submissions (questions, process, must-do, etc.).

    res.json({
      message: "Submission approved and company updated successfully",
      company: companyOut,
      submission: submission,
    });
  } catch (error) {
    console.error("❌ Error approving submission:", error.message);
    console.error("❌ Full error stack:", error.stack);
    console.error("❌ Error name:", error.name);
    console.error("❌ Error details:", error.errors || error);
    
    // Return more detailed error information
    const statusCode = error.name === 'ValidationError' ? 400 : 500;
    res.status(statusCode).json({ 
      error: "Server error", 
      details: error.message,
      errorName: error.name,
      validationErrors: error.errors || null
    });
  }
});

// Paginated companies list — approved: minimal fields; pending: card fields without heavy blobs (roles, JD, solutions, etc.)
adminRouter.get("/companies", async (req, res) => {
  try {
    const { status } = req.query;
    const y = adminCompanyListYearFromQuery(req);
    const { page, limit, skip } = parseAdminPagination(req.query);

    const { total, items: mergedRows } = await listAdminPaginatedCompaniesFromSplit({
      status: status && String(status),
      skip,
      limit,
      placementYear: y,
    });

    const companies = mergedRows.map((m) => projectAdminCompanyListRow(m, status));

    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      items: companies,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (error) {
    console.error("❌ Error fetching companies:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Approve a company (one `company_visits` row — use companyVisitId when several rows share the same year)
adminRouter.post("/companies/:id/approve", async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const companyIdParam = req.params.id;
    const staticRow = await CompanyStatic.findById(companyIdParam).lean();
    if (!staticRow) {
      return res.status(404).json({ error: "Company not found" });
    }

    const visitIdRaw = req.query?.companyVisitId;
    let targetVisit = null;

    if (visitIdRaw && mongoose.Types.ObjectId.isValid(String(visitIdRaw).trim())) {
      const visitOid = new mongoose.Types.ObjectId(String(visitIdRaw).trim());
      targetVisit = await CompanyVisit.findById(visitOid).lean();
      if (
        !targetVisit ||
        !visitRowBelongsToCompanyStatic(targetVisit, staticRow) ||
        normalizeCompanyDetailYear(targetVisit.year) !== y
      ) {
        return res.status(404).json({ error: "Company visit not found for selected year" });
      }
    } else {
      targetVisit = await findOnePendingVisitForCompanyYear(staticRow._id, y, staticRow);
      if (!targetVisit) {
        const loaded = await getCompanyMergedForAdminById(companyIdParam, y);
        if (loaded?.merged?.status === "approved") {
          return res.json({
            message: "Company already approved",
            company: loaded.merged ? companyToJsonSafePlainObject(loaded.merged) : null,
            alreadyApproved: true,
          });
        }
        return res.status(404).json({ error: "No pending company visit found for this year" });
      }
    }

    if (targetVisit.status === "approved") {
      const merged = mergeToLegacyShape(staticRow, targetVisit);
      return res.json({
        message: "Company already approved",
        company: companyToJsonSafePlainObject(merged),
        alreadyApproved: true,
      });
    }
    if (targetVisit.status === "rejected") {
      return res.status(400).json({
        error: "Rejected visits cannot be approved from this action",
      });
    }
    if (targetVisit.status !== "pending") {
      return res.status(400).json({
        error: "Only visits with status \"pending\" can be approved from this action",
      });
    }

    const approvedAt = new Date();
    await approveAndNormalizeSingleCompanyVisitById(
      targetVisit._id,
      approvedAt,
      staticRow._id
    );

    try {
      await invalidateAdminDashboardStatsCache();
    } catch (cacheErr) {
      console.warn("⚠️ Failed to invalidate admin dashboard cache after company approval:", cacheErr?.message || cacheErr);
    }

    const refreshedVisit = await CompanyVisit.findById(targetVisit._id).lean();
    if (refreshedVisit?.status !== "approved") {
      console.error("❌ Company approval did not persist (visit status is not approved):", {
        visitId: String(targetVisit._id),
        status: refreshedVisit?.status,
      });
      return res.status(500).json({
        error:
          "Approval did not persist. The visit row may have an invalid companyId; check server logs.",
      });
    }
    const mergedOut = mergeToLegacyShape(staticRow, refreshedVisit);
    const companyNameForNotify =
      (staticRow.name && String(staticRow.name).trim()) ||
      (mergedOut?.name && String(mergedOut.name).trim()) ||
      "";
    dispatchEvent(EVENT_TYPES.COMPANY_APPROVED, {
      companyId: staticRow._id,
      companyName: companyNameForNotify,
    });
    res.json({
      message: "Company approved successfully",
      company: mergedOut ? companyToJsonSafePlainObject(mergedOut) : null,
      alreadyApproved: false,
    });
  } catch (error) {
    console.error("❌ Error approving company:", error?.message || error);
    console.error("❌ Error name:", error?.name);
    console.error("❌ Error stack:", error?.stack);
    res.status(500).json({ error: "Server error" });
  }
});

// Reject a pending company visit for the selected year (`companyVisitId` when multiple pending rows share the year)
adminRouter.delete("/companies/:id/reject", async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const hint = req.query?.companyVisitId ?? null;

    const del = await deleteCompanyVisitForYear(req.params.id, y, hint, {
      requireStatus: "pending",
    });

    if (!del.deletedVisit) {
      return res.status(400).json({
        error:
          del.wrongStatus === true
            ? "Selected visit is not pending — only status \"pending\" can be rejected here; approved rows use delete"
            : "Pending company visit not found for selected year",
      });
    }

    await invalidateAdminDashboardStatsCache();

    res.json({ message: "Company visit rejected successfully" });
  } catch (error) {
    console.error("❌ Error rejecting company:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Delete an approved company visit for the selected year (`companyVisitId` when multiple approved rows share the year)
adminRouter.delete("/companies/:id/delete", async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const hint = req.query?.companyVisitId ?? null;

    const del = await deleteCompanyVisitForYear(req.params.id, y, hint, {
      requireStatus: "approved",
    });

    if (!del.deletedVisit) {
      return res.status(400).json({
        error:
          del.wrongStatus === true
            ? "Selected visit is not approved"
            : "Approved company visit not found for selected year",
      });
    }

    await invalidateAdminDashboardStatsCache();

    res.json({ message: "Approved company visit deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting approved company:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- Admin edit/delete OA questions, interview questions, interview process ----------
adminRouter.put(
  "/companies/:id/oa-questions/:index",
  validateRequest(adminOaQuestionUpdateSchema),
  async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const loaded = await getCompanyMergedForAdminById(req.params.id, y);
    if (!loaded?.merged) return res.status(404).json({ error: "Company not found" });
    const merged = { ...loaded.merged };
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    const { question, solution } = req.body || {};
    if (!merged.onlineQuestions || index >= merged.onlineQuestions.length)
      return res.status(404).json({ error: "Question not found" });
    if (question !== undefined && question !== null) {
      merged.onlineQuestions = [...(merged.onlineQuestions || [])];
      merged.onlineQuestions[index] = sanitizeText(question);
    }
    if (!merged.onlineQuestions_solution) merged.onlineQuestions_solution = [];
    merged.onlineQuestions_solution = [...merged.onlineQuestions_solution];
    while (merged.onlineQuestions_solution.length < (merged.onlineQuestions || []).length) {
      merged.onlineQuestions_solution.push("");
    }
    if (solution !== undefined && solution !== null) {
      merged.onlineQuestions_solution[index] = sanitizeText(solution);
    }
    await ensureAdminVisitForYear(req.params.id, y);
    await persistMergedCompany(req.params.id, merged, y);
    const out = (await getCompanyMergedForAdminById(req.params.id, y))?.merged;
    res.json({ message: "OA question updated", company: out });
  } catch (error) {
    console.error("❌ Error updating OA question:", error.message);
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

adminRouter.delete("/companies/:id/oa-questions/:index", async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const loaded = await getCompanyMergedForAdminById(req.params.id, y);
    if (!loaded?.merged) return res.status(404).json({ error: "Company not found" });
    const merged = JSON.parse(JSON.stringify(loaded.merged));
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    if (!merged.onlineQuestions || index >= merged.onlineQuestions.length)
      return res.status(404).json({ error: "Question not found" });
    merged.onlineQuestions = [...merged.onlineQuestions];
    merged.onlineQuestions.splice(index, 1);
    if (merged.onlineQuestions_solution && index < merged.onlineQuestions_solution.length) {
      merged.onlineQuestions_solution = [...merged.onlineQuestions_solution];
      merged.onlineQuestions_solution.splice(index, 1);
    }
    await ensureAdminVisitForYear(req.params.id, y);
    await persistMergedCompany(req.params.id, merged, y);
    const out = (await getCompanyMergedForAdminById(req.params.id, y))?.merged;
    res.json({ message: "OA question deleted", company: out });
  } catch (error) {
    console.error("❌ Error deleting OA question:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.put(
  "/companies/:id/interview-questions/:index",
  validateRequest(adminInterviewQuestionUpdateSchema),
  async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const loaded = await getCompanyMergedForAdminById(req.params.id, y);
    if (!loaded?.merged) return res.status(404).json({ error: "Company not found" });
    const merged = JSON.parse(JSON.stringify(loaded.merged));
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    const { question, solution } = req.body || {};
    if (!merged.interviewQuestions || index >= merged.interviewQuestions.length)
      return res.status(404).json({ error: "Question not found" });
    if (question !== undefined && question !== null) {
      merged.interviewQuestions = [...merged.interviewQuestions];
      merged.interviewQuestions[index] = sanitizeText(question);
    }
    if (!merged.interviewQuestions_solution) merged.interviewQuestions_solution = [];
    merged.interviewQuestions_solution = [...merged.interviewQuestions_solution];
    while (merged.interviewQuestions_solution.length < merged.interviewQuestions.length) {
      merged.interviewQuestions_solution.push("");
    }
    if (solution !== undefined && solution !== null) {
      merged.interviewQuestions_solution[index] = sanitizeText(solution);
    }
    await ensureAdminVisitForYear(req.params.id, y);
    await persistMergedCompany(req.params.id, merged, y);
    const out = (await getCompanyMergedForAdminById(req.params.id, y))?.merged;
    res.json({ message: "Interview question updated", company: out });
  } catch (error) {
    console.error("❌ Error updating interview question:", error.message);
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

adminRouter.delete("/companies/:id/interview-questions/:index", async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const loaded = await getCompanyMergedForAdminById(req.params.id, y);
    if (!loaded?.merged) return res.status(404).json({ error: "Company not found" });
    const merged = JSON.parse(JSON.stringify(loaded.merged));
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    if (!merged.interviewQuestions || index >= merged.interviewQuestions.length)
      return res.status(404).json({ error: "Question not found" });
    merged.interviewQuestions = [...merged.interviewQuestions];
    merged.interviewQuestions.splice(index, 1);
    if (merged.interviewQuestions_solution && index < merged.interviewQuestions_solution.length) {
      merged.interviewQuestions_solution = [...merged.interviewQuestions_solution];
      merged.interviewQuestions_solution.splice(index, 1);
    }
    await ensureAdminVisitForYear(req.params.id, y);
    await persistMergedCompany(req.params.id, merged, y);
    const out = (await getCompanyMergedForAdminById(req.params.id, y))?.merged;
    res.json({ message: "Interview question deleted", company: out });
  } catch (error) {
    console.error("❌ Error deleting interview question:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.put(
  "/companies/:id/interview-process/:index",
  validateRequest(adminInterviewProcessUpdateSchema),
  async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const loaded = await getCompanyMergedForAdminById(req.params.id, y);
    if (!loaded?.merged) return res.status(404).json({ error: "Company not found" });
    const merged = JSON.parse(JSON.stringify(loaded.merged));
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    const arr = merged.interviewProcess && Array.isArray(merged.interviewProcess) ? merged.interviewProcess : [];
    if (index >= arr.length) return res.status(404).json({ error: "Entry not found" });
    const { content } = req.body || {};
    if (content === undefined || content === null) return res.status(400).json({ error: "content required" });
    const sanitized = sanitizeText(content);
    let newEntry = arr[index];
    try {
      const parsed = typeof newEntry === "string" ? JSON.parse(newEntry) : {};
      if (parsed && typeof parsed === "object") {
        newEntry = JSON.stringify({ ...parsed, content: sanitized });
      } else newEntry = sanitized;
    } catch {
      newEntry = sanitized;
    }
    merged.interviewProcess = [...arr];
    merged.interviewProcess[index] = newEntry;
    await ensureAdminVisitForYear(req.params.id, y);
    await persistMergedCompany(req.params.id, merged, y);
    const out = (await getCompanyMergedForAdminById(req.params.id, y))?.merged;
    res.json({ message: "Interview process updated", company: out });
  } catch (error) {
    console.error("❌ Error updating interview process:", error.message);
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

adminRouter.delete("/companies/:id/interview-process/:index", async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const loaded = await getCompanyMergedForAdminById(req.params.id, y);
    if (!loaded?.merged) return res.status(404).json({ error: "Company not found" });
    const merged = JSON.parse(JSON.stringify(loaded.merged));
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    if (!merged.interviewProcess || !Array.isArray(merged.interviewProcess) || index >= merged.interviewProcess.length)
      return res.status(404).json({ error: "Entry not found" });
    merged.interviewProcess = [...merged.interviewProcess];
    merged.interviewProcess.splice(index, 1);
    await ensureAdminVisitForYear(req.params.id, y);
    await persistMergedCompany(req.params.id, merged, y);
    const out = (await getCompanyMergedForAdminById(req.params.id, y))?.merged;
    res.json({ message: "Interview process entry deleted", company: out });
  } catch (error) {
    console.error("❌ Error deleting interview process:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.put(
  "/companies/:id/must-do-topics/:index",
  validateRequest(adminMustDoTopicUpdateSchema),
  async (req, res) => {
    try {
      const y = adminVisitYearFromQuery(req);
      const { placementListContext, companyVisitIdHint } =
        adminStatsVisitResolutionArgs(req);
      const loaded = await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint
      );
      if (!loaded?.merged || !loaded?.visit) {
        return res.status(404).json({ error: "Company visit not found" });
      }
      const index = parseInt(req.params.index, 10);
      if (Number.isNaN(index) || index < 0) {
        return res.status(400).json({ error: "Invalid index" });
      }

      const topic = sanitizeText(req.body?.topic);
      if (!topic) return res.status(400).json({ error: "topic required" });

      const result = await mutateMustDoTopicForCompanyCluster(
        req.params.id,
        loaded.visit.cluster,
        index,
        { action: "update", topic }
      );
      if (!result.ok) {
        return res.status(result.reason === "topic_not_found" ? 404 : 400).json({
          error:
            result.reason === "topic_not_found"
              ? "Topic not found"
              : "Unable to update topic",
        });
      }

      const out = (
        await getCompanyMergedForAdminById(
          req.params.id,
          y,
          placementListContext,
          companyVisitIdHint
        )
      )?.merged;
      res.json({ message: "Must do topic updated", company: out });
    } catch (error) {
      console.error("❌ Error updating must do topic:", error.message);
      if (error.name === "ValidationError") {
        return res
          .status(400)
          .json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Server error", details: error.message });
    }
  }
);

adminRouter.delete("/companies/:id/must-do-topics/:index", async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const { placementListContext, companyVisitIdHint } =
      adminStatsVisitResolutionArgs(req);
    const loaded = await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint
    );
    if (!loaded?.merged || !loaded?.visit) {
      return res.status(404).json({ error: "Company visit not found" });
    }
    const index = parseInt(req.params.index, 10);
    if (Number.isNaN(index) || index < 0) {
      return res.status(400).json({ error: "Invalid index" });
    }

    const result = await mutateMustDoTopicForCompanyCluster(
      req.params.id,
      loaded.visit.cluster,
      index,
      { action: "delete" }
    );
    if (!result.ok) {
      return res.status(result.reason === "topic_not_found" ? 404 : 400).json({
        error:
          result.reason === "topic_not_found"
            ? "Topic not found"
            : "Unable to delete topic",
      });
    }

    const out = (
      await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint
      )
    )?.merged;
    res.json({ message: "Must do topic deleted", company: out });
  } catch (error) {
    console.error("❌ Error deleting must do topic:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

// PUT /api/admin/companies/:id/stats - update placement stats (admin only)
adminRouter.put(
  "/companies/:id/stats",
  validateRequest(adminCompanyStatsSchema),
  async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const { placementListContext, companyVisitIdHint } = adminStatsVisitResolutionArgs(req);
    const staticRow = await CompanyStatic.findById(req.params.id).lean();
    if (!staticRow) return res.status(404).json({ error: "Company not found" });
    const {
      totalStudentsApplied,
      totalClearedOA,
      totalGotIn,
      ppoConversionGotIn,
      ppoConversionConverted,
      ppoConversionAcceptanceRate,
      ppoConversionType,
      ppoConversionNotApplicable,
      ppoBranchStats,
      placementGotInBranchStats,
    } = req.body || {};
    const payload = {};
    if (totalStudentsApplied !== undefined) {
      const n = parseInt(totalStudentsApplied, 10);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: "totalStudentsApplied must be a non-negative number" });
      payload.totalStudentsApplied = n;
    }
    if (totalClearedOA !== undefined) {
      const n = parseInt(totalClearedOA, 10);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: "totalClearedOA must be a non-negative number" });
      payload.totalClearedOA = n;
    }
    if (totalGotIn !== undefined) {
      const n = parseInt(totalGotIn, 10);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: "totalGotIn must be a non-negative number" });
      payload.totalGotIn = n;
    }
    if (ppoConversionGotIn !== undefined) {
      const n = parseInt(ppoConversionGotIn, 10);
      if (isNaN(n) || n < 0) {
        return res.status(400).json({ error: "ppoConversionGotIn must be a non-negative number" });
      }
      payload.ppoConversionGotIn = n;
    }
    if (ppoConversionConverted !== undefined) {
      const n = parseInt(ppoConversionConverted, 10);
      if (isNaN(n) || n < 0) {
        return res.status(400).json({ error: "ppoConversionConverted must be a non-negative number" });
      }
      payload.ppoConversionConverted = n;
    }
    if (ppoConversionType !== undefined) {
      payload.ppoConversionType = sanitizeText(ppoConversionType);
    }
    if (ppoConversionNotApplicable !== undefined) {
      payload.ppoConversionNotApplicable = Boolean(ppoConversionNotApplicable);
    }
    if (ppoBranchStats !== undefined) {
      if (!Array.isArray(ppoBranchStats)) {
        return res.status(400).json({ error: "ppoBranchStats must be an array" });
      }
      const normalized = [];
      const seen = new Set();
      for (const row of ppoBranchStats) {
        const code = String(row?.branchCode || "").trim().toLowerCase();
        if (!PPO_BRANCH_CODES.has(code)) {
          return res.status(400).json({ error: `Invalid branch code: ${code}` });
        }
        if (seen.has(code)) {
          return res.status(400).json({ error: `Duplicate branch code: ${code}` });
        }
        seen.add(code);
        const gotIn = Number.parseInt(String(row?.gotIn ?? 0), 10);
        const converted = Number.parseInt(String(row?.converted ?? 0), 10);
        const convertedNotApplicable = Boolean(row?.convertedNotApplicable);
        if (Number.isNaN(gotIn) || gotIn < 0 || Number.isNaN(converted) || converted < 0) {
          return res.status(400).json({ error: `Invalid stats for branch: ${code}` });
        }
        normalized.push({
          branchCode: code,
          gotIn,
          converted: convertedNotApplicable ? 0 : converted,
          convertedNotApplicable,
        });
      }
      payload.ppoBranchStats = normalized;
      const gotInTotal = normalized.reduce((sum, item) => sum + (item.gotIn || 0), 0);
      const gotInTotalWithKnownConversion = normalized.reduce(
        (sum, item) => sum + (item.convertedNotApplicable ? 0 : (item.gotIn || 0)),
        0
      );
      const convertedTotal = normalized.reduce(
        (sum, item) => sum + (item.convertedNotApplicable ? 0 : (item.converted || 0)),
        0
      );
      payload.ppoConversionGotIn = gotInTotal;
      payload.ppoConversionConverted = convertedTotal;
      payload.ppoConversionNotApplicable = normalized.some((item) => item.convertedNotApplicable);
      payload.ppoConversionAcceptanceRate =
        gotInTotalWithKnownConversion > 0
          ? Number(((convertedTotal / gotInTotalWithKnownConversion) * 100).toFixed(2))
          : 0;
    }

    if (placementGotInBranchStats !== undefined) {
      if (!Array.isArray(placementGotInBranchStats)) {
        return res.status(400).json({ error: "placementGotInBranchStats must be an array" });
      }
      const normalizedInput = [];
      const seen = new Set();
      for (const row of placementGotInBranchStats) {
        const code = String(row?.branchCode || "").trim().toLowerCase();
        if (!PPO_BRANCH_CODES.has(code)) {
          return res.status(400).json({ error: `Invalid branch code: ${code}` });
        }
        if (seen.has(code)) {
          return res.status(400).json({ error: `Duplicate branch code: ${code}` });
        }
        seen.add(code);
        const gotIn = Number.parseInt(String(row?.gotIn ?? 0), 10);
        if (Number.isNaN(gotIn) || gotIn < 0) {
          return res.status(400).json({ error: `Invalid gotIn for branch: ${code}` });
        }
        normalizedInput.push({ branchCode: code, gotIn });
      }
      const byCode = new Map(normalizedInput.map((r) => [r.branchCode, r]));
      const fullPlacement = PPO_BRANCH_CODES_ARRAY.map((bc) =>
        byCode.has(bc) ? byCode.get(bc) : { branchCode: bc, gotIn: 0 }
      );
      payload.placementGotInBranchStats = fullPlacement;
      payload.totalGotIn = fullPlacement.reduce((sum, item) => sum + (item.gotIn || 0), 0);
    }

    const hasGotIn = payload.ppoConversionGotIn !== undefined;
    const hasConverted = payload.ppoConversionConverted !== undefined;
    if (hasGotIn || hasConverted) {
      let existingStats = null;
      if (!hasGotIn || !hasConverted) {
        existingStats =
          (await getCompanyMergedForAdminById(
            req.params.id,
            y,
            placementListContext,
            companyVisitIdHint
          ))?.merged || null;
      }
      const gotIn =
        payload.ppoConversionGotIn !== undefined
          ? payload.ppoConversionGotIn
          : Number(existingStats?.ppoConversionGotIn) || 0;
      const converted =
        payload.ppoConversionConverted !== undefined
          ? payload.ppoConversionConverted
          : Number(existingStats?.ppoConversionConverted) || 0;
      payload.ppoConversionAcceptanceRate =
        gotIn > 0 ? Number(((converted / gotIn) * 100).toFixed(2)) : 0;
    } else if (ppoConversionAcceptanceRate !== undefined) {
      const n = Number(ppoConversionAcceptanceRate);
      if (Number.isNaN(n) || n < 0) {
        return res.status(400).json({ error: "ppoConversionAcceptanceRate must be a non-negative number" });
      }
      payload.ppoConversionAcceptanceRate = Number(n.toFixed(2));
    }
    await ensureAdminVisitForYear(req.params.id, y);
    const statsVisitCtx = await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint
    );
    await updateCompanyVisit(req.params.id, payload, y, statsVisitCtx?.visit);
    const out = (await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint
    ))?.merged;
    res.json({ message: "Stats updated", company: out });
  } catch (error) {
    console.error("❌ Error updating company stats:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.patch(
  "/companies/:id/total-got-in",
  validateRequest(adminCompanyTotalGotInAdjustmentSchema),
  async (req, res) => {
    try {
      const y = adminVisitYearFromQuery(req);
      const { placementListContext, companyVisitIdHint } = adminStatsVisitResolutionArgs(req);
      const delta = Number(req.body?.delta);
      await ensureAdminVisitForYear(req.params.id, y);
      const statsVisitCtx = await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint
      );
      const gotInDoc = await adjustVisitTotalGotIn(req.params.id, delta, y, statsVisitCtx?.visit);
      if (!gotInDoc) {
        return res.status(404).json({ error: "Company not found" });
      }

      return res.json({
        message: "Got in count updated",
        companyId: gotInDoc._id,
        totalGotIn: gotInDoc.totalGotIn ?? 0,
      });
    } catch (error) {
      console.error("❌ Error adjusting totalGotIn:", error.message);
      if (error.name === "CastError") {
        return res.status(404).json({ error: "Company not found" });
      }
      return res.status(500).json({ error: "Server error" });
    }
  }
);

// PUT /api/admin/companies/:id/roles - replace roles & CTC details (admin only)
adminRouter.put(
  "/companies/:id/roles",
  validateRequest(adminCompanyRolesSchema),
  async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const { roles } = req.body || {};
    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: "roles must be an array" });
    }

    const normalizedRoles = roles.map((role, index) => {
      const rawName = role?.roleName ?? role?.name ?? "";
      const roleName = sanitizeText(rawName);
      if (!roleName) {
        throw new Error(`Role at index ${index} is missing a valid roleName`);
      }

      const stipStr = String(role.internshipStipend ?? "").trim();
      let internshipStipend;
      if (stipStr && !/^n\/a$/i.test(stipStr)) {
        const n = Number(stipStr.replace(/,/g, ""));
        if (Number.isNaN(n) || n < 0) {
          throw new Error(
            `Role "${roleName}": internshipStipend must be a non‑negative number or N/A`
          );
        }
        if (n > 0) internshipStipend = n;
      }

      const rawCtc = role.ctc && typeof role.ctc === "object" ? role.ctc : {};
      const ctc = {};
      Object.entries(rawCtc).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") {
          return;
        }
        const cleanKey = sanitizeText(key);
        if (!cleanKey) return;
        // Allow both numeric and string CTC components (backend schema uses Mixed)
        const numeric = Number(value);
        // If it's a valid non‑NaN number, store as number; otherwise keep as trimmed string
        ctc[cleanKey] = Number.isNaN(numeric)
          ? String(value).trim()
          : numeric;
      });

      return normalizeRoleStipendFields({
        roleName,
        ctc,
        ...(internshipStipend !== undefined ? { internshipStipend } : {}),
      });
    });

    const staticRow = await CompanyStatic.findById(req.params.id).lean();
    if (!staticRow) {
      return res.status(404).json({ error: "Company not found" });
    }
    await ensureAdminVisitForYear(req.params.id, y);
    const rolesVisitCtx = await getCompanyMergedForAdminById(req.params.id, y);
    await updateCompanyVisit(req.params.id, { roles: normalizedRoles }, y, rolesVisitCtx?.visit);
    const loaded = await getCompanyMergedForAdminById(req.params.id, y);
    const rolesAfterUpdate = loaded?.merged?.roles || [];
    const rolesResponse = (rolesAfterUpdate || []).map((role) => ({
      ...role,
      ctc:
        role && role.ctc instanceof Map
          ? Object.fromEntries(role.ctc)
          : (role && role.ctc) || {},
    }));

    res.json({ message: "Roles updated", roles: rolesResponse });
  } catch (error) {
    console.error("❌ Error updating company roles:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

// Update general company info (eligibility, business model, type, offCampus, date_of_visit on visit row)
adminRouter.put(
  "/companies/:id/general",
  validateRequest(adminCompanyGeneralSchema),
  async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const { eligibility, business_model, type, offCampus, date_of_visit, cluster } =
      req.body || {};

    const updateData = {};
    if (eligibility !== undefined) updateData.eligibility = sanitizeText(eligibility);
    if (business_model !== undefined) updateData.business_model = sanitizeText(business_model);
    if (type !== undefined) updateData.type = sanitizeText(type);
    if (offCampus !== undefined) updateData.offCampus = Boolean(offCampus);
    if (date_of_visit !== undefined) {
      updateData.date_of_visit = sanitizeText(date_of_visit);
    }
    if (cluster !== undefined) {
      updateData.cluster = sanitizeText(cluster);
    }

    const staticRow = await CompanyStatic.findById(req.params.id).lean();
    if (!staticRow) {
      return res.status(404).json({ error: "Company not found" });
    }
    await ensureAdminVisitForYear(req.params.id, y);
    await persistMergedCompany(req.params.id, updateData, y);
    const out = (await getCompanyMergedForAdminById(req.params.id, y))?.merged;

    res.json({ message: "Company general info updated successfully", company: out });
  } catch (error) {
    console.error("❌ Error updating company general info:", error.message);
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    res.status(500).json({ error: "Server error", details: error.message });
  }
});


// Reject submission (delete it from database)
submissionModRouter.delete("/submissions/:id/reject", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Delete the submission
    await Submission.findByIdAndDelete(req.params.id);
    
    console.log('✅ Submission rejected and deleted:', req.params.id);
    
    await invalidateSubmitterListCaches(submission);
    await invalidateAdminDashboardStatsCache();

    res.json({ 
      message: "Submission rejected and deleted successfully"
    });
  } catch (error) {
    console.error('❌ Error rejecting submission:', error);
    res.status(500).json({ 
      error: "Server error", 
      details: error.message
    });
  }
});

// Delete approved submission (remove it from database)
adminRouter.delete("/submissions/:id/delete", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    if (submission.status !== 'approved') {
      return res.status(400).json({ error: "Only approved submissions can be deleted using this endpoint" });
    }

    // Delete the submission
    await Submission.findByIdAndDelete(req.params.id);
    
    console.log('✅ Approved submission deleted:', req.params.id);
    
    await invalidateSubmitterListCaches(submission);
    await invalidateAdminDashboardStatsCache();

    res.json({ 
      message: "Approved submission deleted successfully"
    });
  } catch (error) {
    console.error('❌ Error deleting approved submission:', error);
    res.status(500).json({ 
      error: "Server error", 
      details: error.message
    });
  }
});

export default adminRouter;

