import {
  DEFAULT_COLLEGE_ID,
  COLLEGE_ID_RVITM,
  collegeIdFromUser,
  emailBelongsToCollege,
  normalizeCollegeId,
  withCollegeEmailScope,
} from "../utils/collegeScope.js";
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import XLSX from "xlsx";
import authJWT from "../middleware/authJWT.js";
import authorize from "../middleware/authorize.js";
import requireAdmin from "../middleware/requireAdmin.js";
import requireAdminOrSpc from "../middleware/requireAdminOrSpc.js";
import attachSpcCluster from "../middleware/attachSpcCluster.js";
import validateRequest from "../middleware/validateRequest.js";
import {
  adminOaQuestionUpdateSchema,
  adminInterviewQuestionUpdateSchema,
  adminInterviewProcessUpdateSchema,
  adminMustDoTopicUpdateSchema,
  adminRecruitmentProcessSchema,
  adminCompanyStatsSchema,
  adminCompanyTotalGotInAdjustmentSchema,
  adminCompanyRolesSchema,
  adminCompanyGeneralSchema,
  adminPlacementHubSettingsSchema,
  adminTrendingCardPinSchema,
  adminTrendingCardCompanyQuerySchema,
} from "../validations/admin.validation.js";
import { spcCompanySuggestQuerySchema } from "../validations/placement.validation.js";
import {
  getPlacementHubSettingsForApi,
  updatePlacementHubOpenDreamThresholds,
} from "../services/placementHubSettingsService.js";
import { listAdminStudentRequests } from "../services/adminStudentRequestsService.js";
import {
  approveInterviewLimitRequest,
  dismissInterviewLimitRequest,
} from "../services/interviewLimitRequestService.js";
import User1 from "../models/User1.js";
import Student from "../models/Student.js";
import Submission from "../models/Submission.js";
import CompanyStatic from "../models/CompanyStatic.js";
import CompanyVisit from "../models/CompanyVisit.js";
import Notification from "../models/Notification.js";
import InterviewLimitRequest from "../models/InterviewLimitRequest.js";
import { getAdminStats } from "../controllers/adminStatsController.js";
import { invalidateAdminDashboardStatsCache } from "../services/adminDashboardStatsCache.js";
import { getAdminUsageAnalytics } from "../services/adminUsageAnalyticsService.js";
import {
  getDauSummaryForAdmin,
  getDauDayForAdmin,
  getDauDayUserActivityForAdmin,
  getDauFullExportRows,
} from "../services/admin/adminDauService.js";
import {
  invalidateMySubmissionsCacheByEmail,
  submitterEmailFromSubmission,
} from "../services/mySubmissionsCache.js";
import { invalidateSpcMyRecordsCacheByEmail } from "../services/spcMyRecordsCache.js";
import { getStudentPlacementStats } from "../services/studentPlacementStatsCache.js";
import { invalidateCompanyDetailCache } from "../services/companyDetailCache.js";
import { invalidateVisitRoles2026Cache } from "../services/companyListCache.js";
import {
  approveSubmissionAndUpdateCompany,
  approveSubmissionsBatch,
  MAX_SUBMISSION_APPROVE_BATCH_SIZE,
} from "../services/submissionApprovalService.js";
import { normalizePlacementClusterQuery, clusterKeyFromPlacementVisitClusterField, canonicalVisitClusterLabel, PLACEMENT_HUB_CLUSTER_LABELS, mongoMatchForPlacementHubCluster } from "../utils/placementCluster.js";
import {
  isSpcActor,
  normalizeAssignedSpcCluster,
  SPC_CLUSTER_MISSING_VISIT_MESSAGE,
  SPC_CLUSTER_NOT_ASSIGNED_MESSAGE,
  SPC_CLUSTER_SUBMISSION_FORBIDDEN_MESSAGE,
} from "../utils/spcCluster.js";

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
  deleteSplitCompany,
  ensureAdminVisitForYear,
  getCompanyMergedForAdminById,
  listAdminPaginatedCompaniesFromSplit,
  mutateMustDoTopicForCompanyCluster,
  normalizeCompanyDetailYear,
  normalizeVisitKeyParts,
  persistMergedCompany,
  suggestCompaniesForSpc,
  updateCompanyStatic,
  updateCompanyVisit,
} from "../services/companyService.js";
import { invalidateLeaderboardCache } from "./leaderboardRoutes.js";
import { dispatchEvent } from "../services/events/eventDispatcher.js";
import { EVENT_TYPES } from "../services/events/eventTypes.js";
import { PPO_BRANCH_CODES, PPO_BRANCH_CODES_ARRAY, normalizePpoBranchCode } from "../utils/ppoBranchCodes.js";
import {
  importStudentsFromXlsxBuffer,
  STUDENT_BATCH_COLUMN_GUIDE,
} from "../services/studentBatchImportService.js";
import {
  extractJdFieldsWithLlm,
  extractTextFromPdfBuffer,
  normalizeExtractFieldNames,
  suggestJdFieldNamesWithLlm,
} from "../services/jdImportService.js";
import {
  planJdRoleFieldUpdate,
  normalizeAdminRoleInput,
} from "../utils/normalizeAdminRole.js";
import {
  buildGeneralStatsFromXlsxBuffer,
  statsDocumentFromPayload,
} from "../services/placementGeneralStatsImportService.js";
import {
  listGeneralStatsMeta,
  saveGeneralStatsForCollege,
} from "../services/placementGeneralStatsCache.js";
import { parseGeneralStatsYear } from "../utils/generalStatsYears.js";
import {
  listPinnedTrendingCards,
  listApprovedVisitsForTrendingPicker,
  pinVisitTrending,
  unpinVisitTrending,
} from "../services/companyCardTrending.js";
import { touchCardContentUpdated } from "../services/companyCardContentUpdated.js";
import {
  generateSubmissionAnswer,
  isSubmissionAddAnswerSupported,
} from "../services/submissionAnswerService.js";
import { sanitizeRecruitmentProcess, withRecruitmentProcessSubmitter } from "../utils/recruitmentProcess.js";
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

const jdPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const nameOk = /\.pdf$/i.test(file.originalname || "");
    const mimeOk =
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/x-pdf";
    if (nameOk || mimeOk) cb(null, true);
    else cb(new Error("Only PDF files are allowed."));
  },
});

// JWT first; submission moderation allows admin session OR SPC; everything else admin-only
adminRouter.use(authJWT);
submissionModRouter.use(authorize(["admin", "spc"]));
submissionModRouter.use(requireAdminOrSpc);
submissionModRouter.use(attachSpcCluster);
adminRouter.use(submissionModRouter);
adminRouter.use(authorize(["admin"]));
adminRouter.use(requireAdmin);

function forbidRvitmAdminCompanyMutations(req, res, next) {
  if (collegeIdFromUser(req.user) === COLLEGE_ID_RVITM) {
    return res.status(403).json({
      error:
        "RVITM admins cannot edit shared company content or approve/reject companies",
    });
  }
  return next();
}

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

adminRouter.get("/placement-general-stats/meta", async (req, res) => {
  try {
    const meta = await listGeneralStatsMeta(collegeIdFromUser(req.user));
    return res.json(meta);
  } catch (error) {
    console.error("❌ Admin general stats meta:", error?.message || error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

adminRouter.post(
  "/placement-general-stats/import",
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
      const year = parseGeneralStatsYear(req.body?.year);
      if (year == null) {
        return res.status(400).json({
          success: false,
          error: "Invalid year. Choose 2024, 2025, 2026, 2027, or 2028.",
        });
      }

      if (!req.file?.buffer) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded. Use the form field name "file".',
        });
      }

      const parsed = buildGeneralStatsFromXlsxBuffer(req.file.buffer, year);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: parsed.error,
          details: parsed.details,
        });
      }

      const uploadedBy = String(req.user?.email || "").trim();
      const sourceFileName = String(req.file.originalname || "").trim();
      const docPayload = statsDocumentFromPayload(
        parsed.stats,
        uploadedBy,
        sourceFileName
      );

      const saved = await saveGeneralStatsForCollege(
        year,
        collegeIdFromUser(req.user),
        docPayload
      );

      return res.json({
        success: true,
        year,
        totalOffers: saved.totalOffers,
        companiesRecruited: saved.kpis?.companiesRecruited,
        lastUpdatedAt: saved.updatedAt,
        sourceFileName,
        message: `General placement statistics for ${year} updated successfully.`,
      });
    } catch (error) {
      console.error("❌ Admin general stats import:", error?.message || error);
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
  const placementCluster = normalizePlacementClusterQuery(req.query?.placementCluster);
  return { placementListContext, companyVisitIdHint, placementCluster };
}

/** Placement year + visit row for admin company edits (year / hub / visit id from query). */
function adminVisitContextFromReq(req) {
  const y = adminVisitYearFromQuery(req);
  const { placementListContext, companyVisitIdHint, placementCluster } =
    adminStatsVisitResolutionArgs(req);
  return { y, placementListContext, companyVisitIdHint, placementCluster };
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

// Get total number of users (college-scoped for the logged-in admin)
adminRouter.get("/stats/users", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const totalUsers = await User1.countDocuments(
      withCollegeEmailScope({}, collegeId, "email")
    );
    res.json({ totalUsers, collegeId });
  } catch (error) {
    console.error("❌ Error fetching user count:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.get(
  "/companies/suggest",
  validateRequest({ querySchema: spcCompanySuggestQuerySchema }),
  async (req, res) => {
    try {
      const { q, limit } = req.query;
      const items = await suggestCompaniesForSpc(q, limit);
      return res.json({ items });
    } catch (error) {
      console.error("❌ Error in admin company suggest:", error.message);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

// Branch-wise placed students grouped by placement year (admin-only)
adminRouter.get("/students/placement-stats", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const data = await getStudentPlacementStats(req.query?.year, collegeId);
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
    const collegeId = collegeIdFromUser(req.user);
    const data = await getStudentPlacementStats(req.query?.year, collegeId);
    const workbook = XLSX.utils.book_new();

    const mapStudentRow = (student, branchCode) => ({
      Program: String(branchCode || student.branchCode || "").toUpperCase(),
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
      "Last Updated": student.updatedAt || student.createdAt || "",
    });

    const allRows = [];
    for (const branch of data.branches) {
      const branchCode = branch.branchCode || "";
      const rows = (Array.isArray(branch.students) ? branch.students : []).map((student) =>
        mapStudentRow(student, branchCode)
      );
      allRows.push(...rows);
    }

    if (allRows.length > 0) {
      const allWs = XLSX.utils.json_to_sheet(allRows);
      XLSX.utils.book_append_sheet(workbook, allWs, "ALL");
    }

    for (const branch of data.branches) {
      const branchCode = branch.branchCode || "";
      const rows = (Array.isArray(branch.students) ? branch.students : []).map((student) =>
        mapStudentRow(student, branchCode)
      );
      const ws = XLSX.utils.json_to_sheet(rows);
      const sheetName =
        String(branchCode || "unknown")
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

function serializeSpcUser(user) {
  const cluster = normalizePlacementClusterQuery(user?.spcCluster);
  return {
    _id: user._id,
    email: user.email,
    username: user.username,
    role: user.role,
    spcCluster: cluster,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    profilePicture: user.profilePicture,
  };
}

// Assign SPC role to an existing user (admin-only via router middleware)
adminRouter.post("/assign-spc", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const normalizedEmail = String(req.body?.email || "").trim().toLowerCase();
    const normalizedUsn = String(req.body?.usn || "").trim().toUpperCase();
    const spcCluster = normalizeAssignedSpcCluster(req.body?.cluster ?? req.body?.spcCluster, collegeId);

    if (!normalizedEmail) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!normalizedUsn) {
      return res.status(400).json({ error: "USN is required" });
    }
    if (!spcCluster) {
      return res.status(400).json({ error: "Cluster is required" });
    }
    if (!emailBelongsToCollege(normalizedEmail, collegeId)) {
      return res.status(403).json({ error: "Student is outside your college scope." });
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
          spcCluster,
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
        runValidators: true,
      }
    );

    await invalidateSpcMyRecordsCacheByEmail(normalizedEmail).catch(() => {});

    return res.json({
      message: "SPC role assigned successfully",
      user: serializeSpcUser(user),
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
    const collegeId = collegeIdFromUser(req.user);
    const spcs = await User1.find(withCollegeEmailScope({ role: "spc" }, collegeId, "email"))
      .select("_id username email profilePicture role spcCluster createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ items: spcs.map(serializeSpcUser) });
  } catch (error) {
    console.error("❌ Error fetching SPC users:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
});

adminRouter.patch("/spcs/:id/cluster", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const spcCluster = normalizeAssignedSpcCluster(req.body?.cluster ?? req.body?.spcCluster, collegeId);
    if (!spcCluster) {
      return res.status(400).json({ error: "Cluster is required" });
    }

    const user = await User1.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.role !== "spc") {
      return res.status(400).json({ error: "User is not currently an SPC" });
    }
    if (!emailBelongsToCollege(user.email, collegeId)) {
      return res.status(403).json({ error: "SPC is outside your college scope." });
    }

    user.spcCluster = spcCluster;
    await user.save();
    await invalidateSpcMyRecordsCacheByEmail(user.email).catch(() => {});

    return res.json({
      message: "SPC cluster updated successfully",
      user: serializeSpcUser(user),
    });
  } catch (error) {
    console.error("❌ Error updating SPC cluster:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
});

adminRouter.patch("/spcs/:id/revoke", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const user = await User1.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role !== "spc") {
      return res.status(400).json({ error: "User is not currently an SPC" });
    }
    if (!emailBelongsToCollege(user.email, collegeId)) {
      return res.status(403).json({ error: "SPC is outside your college scope." });
    }

    const updated = await User1.findByIdAndUpdate(
      user._id,
      { $set: { role: "student" }, $unset: { spcCluster: 1 } },
      { new: true }
    );
    await invalidateSpcMyRecordsCacheByEmail(user.email).catch(() => {});

    return res.json({
      message: "SPC access revoked successfully",
      user: serializeSpcUser({ ...(updated?.toObject?.() || updated), spcCluster: null }),
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

/** @returns {boolean} true when response already sent (forbidden) */
function rejectIfSubmissionOutsideAdminCollege(submission, req, res) {
  const collegeId = collegeIdFromUser(req.user);
  if (emailBelongsToCollege(submission?.submittedBy?.email, collegeId)) {
    return false;
  }
  res.status(403).json({ error: "Submission is outside your college scope." });
  return true;
}

async function visitIdsForSpcCluster(spcCluster) {
  const visitMatch = mongoMatchForPlacementHubCluster(spcCluster);
  if (!visitMatch) return [];
  const visits = await CompanyVisit.find(visitMatch).select("_id").lean();
  return visits.map((visit) => visit._id);
}

function withSpcVisitClusterScope(baseQuery, visitIds) {
  const visitScope = {
    companyVisitId: { $in: visitIds, $ne: null },
  };
  if (!baseQuery || typeof baseQuery !== "object" || Object.keys(baseQuery).length === 0) {
    return visitScope;
  }
  return { $and: [baseQuery, visitScope] };
}

/** @returns {Promise<boolean>} true when response already sent (forbidden) */
async function rejectIfSubmissionOutsideSpcCluster(submission, req, res) {
  if (!isSpcActor(req.user)) return false;
  const cluster = req.spcCluster;
  if (!cluster) {
    res.status(403).json({ error: SPC_CLUSTER_NOT_ASSIGNED_MESSAGE });
    return true;
  }
  const visitId = submission?.companyVisitId;
  if (!visitId) {
    res.status(403).json({ error: SPC_CLUSTER_MISSING_VISIT_MESSAGE });
    return true;
  }
  const visit = await CompanyVisit.findById(visitId).select("cluster").lean();
  if (!visit) {
    res.status(403).json({ error: SPC_CLUSTER_MISSING_VISIT_MESSAGE });
    return true;
  }
  const hub = clusterKeyFromPlacementVisitClusterField(visit.cluster);
  if (hub !== cluster) {
    res.status(403).json({ error: SPC_CLUSTER_SUBMISSION_FORBIDDEN_MESSAGE });
    return true;
  }
  return false;
}

// Paginated submissions list (trimmed content for table rows; use GET /submissions/:id for full body)
submissionModRouter.get("/submissions", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const { status } = req.query;
    const baseQuery = status ? { status } : {};
    let query = withCollegeEmailScope(baseQuery, collegeId, "submittedBy.email");
    const { page, limit, skip } = parseAdminPagination(req.query);

    if (isSpcActor(req.user)) {
      if (!req.spcCluster) {
        return res.json({
          items: [],
          total: 0,
          page,
          limit,
          totalPages: 1,
          collegeId,
          spcCluster: null,
        });
      }
      const visitIds = await visitIdsForSpcCluster(req.spcCluster);
      query = withSpcVisitClusterScope(query, visitIds);
    }

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
      collegeId,
      ...(isSpcActor(req.user) ? { spcCluster: req.spcCluster } : {}),
    });
  } catch (error) {
    console.error("❌ Error fetching submissions:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Full submission (e.g. admin modal)
submissionModRouter.get("/submissions/:id", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const submission = await Submission.findById(req.params.id).populate({ path: "companyId", select: "name", model: "CompanyStatic" });
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (!emailBelongsToCollege(submission?.submittedBy?.email, collegeId)) {
      return res.status(403).json({ error: "Submission is outside your college scope." });
    }
    if (await rejectIfSubmissionOutsideSpcCluster(submission, req, res)) return;
    const [enrichedSubmission] = await enrichSubmissionVisitMeta([submission]);
    res.json(enrichedSubmission);
  } catch (error) {
    console.error("❌ Error fetching submission:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Get dashboard stats (Redis-cached when REDIS_URL is set; invalidated on admin mutations)
adminRouter.get("/stats", getAdminStats);

/** Daily active users — lightweight day counts (fetched only when admin opens DAU modal). */
adminRouter.get("/dau", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const days = Math.min(30, Math.max(1, Number(req.query?.days) || 7));
    const data = await getDauSummaryForAdmin(days, collegeId);
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error("GET /api/admin/dau:", err?.message || err);
    return res.status(500).json({ error: "Failed to load daily active users" });
  }
});

/** Full stored DAU history for Excel export (college-scoped). */
adminRouter.get("/dau/export", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const data = await getDauFullExportRows(collegeId);
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error("GET /api/admin/dau/export:", err?.message || err);
    return res.status(500).json({ error: "Failed to export daily active users" });
  }
});

/** Activity chips for one user on one day (fetched when admin expands that row). */
adminRouter.get("/dau/:dayKey/users/:userId", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const data = await getDauDayUserActivityForAdmin(
      req.params.dayKey,
      req.params.userId,
      collegeId
    );
    return res.json({ success: true, ...data });
  } catch (err) {
    const code = err?.code || "";
    if (code === "INVALID_DAY" || code === "INVALID_USER") {
      return res.status(400).json({ error: err.message, code });
    }
    if (code === "NOT_FOUND") {
      return res.status(404).json({ error: err.message, code });
    }
    console.error("GET /api/admin/dau/:dayKey/users/:userId:", err?.message || err);
    return res.status(500).json({ error: "Failed to load user activity" });
  }
});

/** Users for one day (fetched only when admin clicks a day chip). */
adminRouter.get("/dau/:dayKey", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const data = await getDauDayForAdmin(req.params.dayKey, collegeId);
    return res.json({ success: true, ...data });
  } catch (err) {
    const code = err?.code || "";
    if (code === "INVALID_DAY") {
      return res.status(400).json({ error: err.message, code });
    }
    console.error("GET /api/admin/dau/:dayKey:", err?.message || err);
    return res.status(500).json({ error: "Failed to load daily active users for day" });
  }
});

/** AI mock interviews + PrepPath generation usage (day-wise IST + totals). */
adminRouter.get("/usage-analytics", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const data = await getAdminUsageAnalytics({
      days: req.query?.days,
      collegeId,
    });
    return res.json(data);
  } catch (err) {
    console.error("GET /api/admin/usage-analytics:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

adminRouter.get("/trending-cards", async (_req, res) => {
  try {
    const items = await listPinnedTrendingCards();
    return res.json({ items, pinHours: 24 });
  } catch (err) {
    console.error("GET /api/admin/trending-cards:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

adminRouter.get(
  "/trending-cards/visits",
  validateRequest({ querySchema: adminTrendingCardCompanyQuerySchema }),
  async (req, res) => {
    try {
      const items = await listApprovedVisitsForTrendingPicker(req.query.companyId);
      return res.json({ items });
    } catch (err) {
      console.error("GET /api/admin/trending-cards/visits:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

adminRouter.post(
  "/trending-cards",
  validateRequest(adminTrendingCardPinSchema),
  async (req, res) => {
    try {
      const item = await pinVisitTrending(req.body.visitId);
      return res.json({
        message: "Company card marked trending for 24 hours",
        item,
      });
    } catch (err) {
      const status = Number(err?.statusCode) || 500;
      if (status < 500) {
        return res.status(status).json({ error: err.message });
      }
      console.error("POST /api/admin/trending-cards:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

adminRouter.delete("/trending-cards/:visitId", async (req, res) => {
  try {
    const visitId = String(req.params.visitId || "").trim();
    if (!/^[a-fA-F0-9]{24}$/.test(visitId)) {
      return res.status(400).json({ error: "Invalid visitId" });
    }
    await unpinVisitTrending(visitId);
    return res.json({ message: "Trending mark removed" });
  } catch (err) {
    console.error("DELETE /api/admin/trending-cards/:visitId:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

adminRouter.get("/student-requests", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const data = await listAdminStudentRequests(collegeId);
    return res.json(data);
  } catch (err) {
    console.error("GET /api/admin/student-requests:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

adminRouter.post("/interview-limit-requests/:requestId/approve", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const pending = await InterviewLimitRequest.findById(req.params.requestId)
      .select("email status")
      .lean();
    if (!pending || pending.status !== "pending") {
      return res.status(404).json({ error: "Request not found." });
    }
    if (!emailBelongsToCollege(pending.email, collegeId)) {
      return res.status(403).json({ error: "Request is outside your college scope." });
    }
    const result = await approveInterviewLimitRequest(req.params.requestId, req.user);
    if (!result.ok) {
      return res.status(result.reason === "not_found" ? 404 : 400).json({
        error: result.reason === "not_found" ? "Request not found." : "Could not approve request.",
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/admin/interview-limit-requests/:id/approve:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

adminRouter.post("/interview-limit-requests/:requestId/dismiss", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
    const pending = await InterviewLimitRequest.findById(req.params.requestId)
      .select("email status")
      .lean();
    if (!pending || pending.status !== "pending") {
      return res.status(404).json({ error: "Request not found." });
    }
    if (!emailBelongsToCollege(pending.email, collegeId)) {
      return res.status(403).json({ error: "Request is outside your college scope." });
    }
    const result = await dismissInterviewLimitRequest(req.params.requestId, req.user);
    if (!result.ok) {
      return res.status(result.reason === "not_found" ? 404 : 400).json({
        error: result.reason === "not_found" ? "Request not found." : "Could not dismiss request.",
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/admin/interview-limit-requests/:id/dismiss:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

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
    if (rejectIfSubmissionOutsideAdminCollege(submission, req, res)) return;
    if (await rejectIfSubmissionOutsideSpcCluster(submission, req, res)) return;
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
    const submission = await Submission.findById(req.params.id).select(
      "type content status submittedBy"
    );
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (rejectIfSubmissionOutsideAdminCollege(submission, req, res)) return;
    if (await rejectIfSubmissionOutsideSpcCluster(submission, req, res)) return;
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

function reviewerFromRequest(req) {
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
  return {
    role: reviewerRole,
    name: reviewerName,
    email: String(req.user?.email || "").trim(),
  };
}

// Batch-approve pending submissions (grouped by company visit; parallel across visits)
submissionModRouter.post("/submissions/approve-batch", async (req, res) => {
  try {
    const collegeId = collegeIdFromUser(req.user);
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
      .map((id) => {
        try {
          return new mongoose.Types.ObjectId(String(id));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    let scopedQuery = withCollegeEmailScope({ _id: { $in: objectIds } }, collegeId, "submittedBy.email");
    if (isSpcActor(req.user)) {
      if (!req.spcCluster) {
        return res.status(403).json({ error: SPC_CLUSTER_NOT_ASSIGNED_MESSAGE });
      }
      const visitIds = await visitIdsForSpcCluster(req.spcCluster);
      scopedQuery = withSpcVisitClusterScope(scopedQuery, visitIds);
    }
    const scoped = await Submission.find(scopedQuery)
      .select("_id")
      .lean();
    const scopedIds = scoped.map((s) => String(s._id));
    if (scopedIds.length === 0) {
      return res.status(403).json({
        error: "None of the selected submissions are in your college scope.",
      });
    }

    const summary = await approveSubmissionsBatch(scopedIds, reviewerFromRequest(req));

    res.json({
      message: `Batch approval finished: ${summary.successCount} succeeded, ${summary.failCount} failed.`,
      ...summary,
      skippedOutsideCollege: rawIds.length - scopedIds.length,
    });
  } catch (error) {
    console.error("❌ Error in batch submission approval:", error.message);
    res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
});

// Approve submission and update company (targeted visit update + per-visit lock)
submissionModRouter.post("/submissions/:id/approve", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (rejectIfSubmissionOutsideAdminCollege(submission, req, res)) return;
    if (await rejectIfSubmissionOutsideSpcCluster(submission, req, res)) return;

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
        } catch (e) {
          return res.status(400).json({
            error: String(e?.message || e || "Invalid mergeContent"),
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

    res.json({
      message: "Submission approved and company updated successfully",
      submission: result.submission,
      companyId: result.companyId,
      visitId: result.visitId,
    });
  } catch (error) {
    console.error("❌ Error approving submission:", error.message);
    const statusCode =
      error.message === "Company not found"
        ? 404
        : error.message === "Only pending submissions can be approved."
          ? 400
          : 500;
    res.status(statusCode).json({
      error: statusCode === 500 ? "Server error" : error.message,
      details: error.message,
      errorName: error.name,
      validationErrors: error.errors || null,
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
adminRouter.post("/companies/:id/approve", forbidRvitmAdminCompanyMutations, async (req, res) => {
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
adminRouter.delete("/companies/:id/reject", forbidRvitmAdminCompanyMutations, async (req, res) => {
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
  forbidRvitmAdminCompanyMutations,
  validateRequest(adminOaQuestionUpdateSchema),
  async (req, res) => {
  try {
    const { y, placementListContext, companyVisitIdHint, placementCluster } = adminVisitContextFromReq(req);
    const loaded = await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
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
    await persistMergedCompany(
      req.params.id,
      merged,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
    const out = (
      await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint,
        placementCluster
      )
    )?.merged;
    res.json({ message: "OA question updated", company: out });
  } catch (error) {
    console.error("❌ Error updating OA question:", error.message);
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

adminRouter.delete("/companies/:id/oa-questions/:index", forbidRvitmAdminCompanyMutations, async (req, res) => {
  try {
    const { y, placementListContext, companyVisitIdHint, placementCluster } = adminVisitContextFromReq(req);
    const loaded = await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
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
    await persistMergedCompany(
      req.params.id,
      merged,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
    const out = (
      await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint,
        placementCluster
      )
    )?.merged;
    res.json({ message: "OA question deleted", company: out });
  } catch (error) {
    console.error("❌ Error deleting OA question:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.put(
  "/companies/:id/interview-questions/:index",
  forbidRvitmAdminCompanyMutations,
  validateRequest(adminInterviewQuestionUpdateSchema),
  async (req, res) => {
  try {
    const { y, placementListContext, companyVisitIdHint, placementCluster } = adminVisitContextFromReq(req);
    const loaded = await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
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
    await persistMergedCompany(
      req.params.id,
      merged,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
    const out = (
      await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint,
        placementCluster
      )
    )?.merged;
    res.json({ message: "Interview question updated", company: out });
  } catch (error) {
    console.error("❌ Error updating interview question:", error.message);
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

adminRouter.delete("/companies/:id/interview-questions/:index", forbidRvitmAdminCompanyMutations, async (req, res) => {
  try {
    const { y, placementListContext, companyVisitIdHint, placementCluster } = adminVisitContextFromReq(req);
    const loaded = await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
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
    await persistMergedCompany(
      req.params.id,
      merged,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
    const out = (
      await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint,
        placementCluster
      )
    )?.merged;
    res.json({ message: "Interview question deleted", company: out });
  } catch (error) {
    console.error("❌ Error deleting interview question:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.put(
  "/companies/:id/interview-process/:index",
  forbidRvitmAdminCompanyMutations,
  validateRequest(adminInterviewProcessUpdateSchema),
  async (req, res) => {
  try {
    const { y, placementListContext, companyVisitIdHint, placementCluster } = adminVisitContextFromReq(req);
    const loaded = await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
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
    await persistMergedCompany(
      req.params.id,
      merged,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
    const out = (
      await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint,
        placementCluster
      )
    )?.merged;
    res.json({ message: "Interview process updated", company: out });
  } catch (error) {
    console.error("❌ Error updating interview process:", error.message);
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

adminRouter.delete("/companies/:id/interview-process/:index", forbidRvitmAdminCompanyMutations, async (req, res) => {
  try {
    const { y, placementListContext, companyVisitIdHint, placementCluster } = adminVisitContextFromReq(req);
    const loaded = await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
    if (!loaded?.merged) return res.status(404).json({ error: "Company not found" });
    const merged = JSON.parse(JSON.stringify(loaded.merged));
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    if (!merged.interviewProcess || !Array.isArray(merged.interviewProcess) || index >= merged.interviewProcess.length)
      return res.status(404).json({ error: "Entry not found" });
    merged.interviewProcess = [...merged.interviewProcess];
    merged.interviewProcess.splice(index, 1);
    await ensureAdminVisitForYear(req.params.id, y);
    await persistMergedCompany(
      req.params.id,
      merged,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
    const out = (
      await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint,
        placementCluster
      )
    )?.merged;
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
      const { placementListContext, companyVisitIdHint, placementCluster } =
        adminStatsVisitResolutionArgs(req);
      const loaded = await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint,
        placementCluster
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
          companyVisitIdHint,
          placementCluster
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
      companyVisitIdHint,
      placementCluster
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
        companyVisitIdHint,
        placementCluster
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
    const { placementListContext, companyVisitIdHint, placementCluster } = adminStatsVisitResolutionArgs(req);
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
        const code = normalizePpoBranchCode(row?.branchCode);
        if (!PPO_BRANCH_CODES.has(code)) {
          return res.status(400).json({ error: `Invalid program code: ${code}` });
        }
        if (seen.has(code)) {
          return res.status(400).json({ error: `Duplicate program code: ${code}` });
        }
        seen.add(code);
        const gotIn = Number.parseInt(String(row?.gotIn ?? 0), 10);
        const converted = Number.parseInt(String(row?.converted ?? 0), 10);
        const convertedNotApplicable = Boolean(row?.convertedNotApplicable);
        if (Number.isNaN(gotIn) || gotIn < 0 || Number.isNaN(converted) || converted < 0) {
          return res.status(400).json({ error: `Invalid stats for program: ${code}` });
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
        const code = normalizePpoBranchCode(row?.branchCode);
        if (!PPO_BRANCH_CODES.has(code)) {
          return res.status(400).json({ error: `Invalid program code: ${code}` });
        }
        if (seen.has(code)) {
          return res.status(400).json({ error: `Duplicate program code: ${code}` });
        }
        seen.add(code);
        const gotIn = Number.parseInt(String(row?.gotIn ?? 0), 10);
        if (Number.isNaN(gotIn) || gotIn < 0) {
          return res.status(400).json({ error: `Invalid gotIn for program: ${code}` });
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
            companyVisitIdHint,
            placementCluster
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
      companyVisitIdHint,
      placementCluster
    );
    const adminCollegeId = collegeIdFromUser(req.user);
    await updateCompanyVisit(
      req.params.id,
      payload,
      y,
      statsVisitCtx?.visit,
      { collegeId: adminCollegeId }
    );
    const out = (await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster,
      adminCollegeId
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
      const { placementListContext, companyVisitIdHint, placementCluster } = adminStatsVisitResolutionArgs(req);
      const delta = Number(req.body?.delta);
      await ensureAdminVisitForYear(req.params.id, y);
      const statsVisitCtx = await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint,
        placementCluster
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
  forbidRvitmAdminCompanyMutations,
  validateRequest(adminCompanyRolesSchema),
  async (req, res) => {
  try {
    const { y, placementListContext, companyVisitIdHint, placementCluster } = adminVisitContextFromReq(req);
    const { roles } = req.body || {};
    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: "roles must be an array" });
    }

    const normalizedRoles = roles.map((role, index) =>
      normalizeAdminRoleInput(role, index)
    );

    const staticRow = await CompanyStatic.findById(req.params.id).lean();
    if (!staticRow) {
      return res.status(404).json({ error: "Company not found" });
    }
    await ensureAdminVisitForYear(req.params.id, y);
    const rolesVisitCtx = await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
    const adminCollegeId = collegeIdFromUser(req.user);
    await updateCompanyVisit(
      req.params.id,
      { roles: normalizedRoles },
      y,
      rolesVisitCtx?.visit,
      { collegeId: adminCollegeId }
    );
    const loaded = await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster,
      adminCollegeId
    );
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
    const { y, placementListContext, companyVisitIdHint, placementCluster } = adminVisitContextFromReq(req);
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
    await persistMergedCompany(
      req.params.id,
      updateData,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
    const out = (
      await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint,
        placementCluster
      )
    )?.merged;

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
submissionModRouter.put(
  "/companies/:id/recruitment-process",
  validateRequest(adminRecruitmentProcessSchema),
  async (req, res) => {
    try {
      const { y, placementListContext, companyVisitIdHint, placementCluster } =
        adminVisitContextFromReq(req);
      const loaded = await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint,
        placementCluster
      );
      if (!loaded?.merged) {
        return res.status(404).json({ error: "Company not found" });
      }
      if (!loaded.visit?._id) {
        return res.status(404).json({ error: "Company visit not found for this year." });
      }

      const sanitized = sanitizeRecruitmentProcess(req.body?.recruitment_process);
      if (!sanitized.ok) {
        return res.status(400).json({ error: sanitized.error });
      }

      const loginEmail = String(req.user?.email || "").trim().toLowerCase();
      const studentLean =
        loginEmail !== ""
          ? await Student.findOne({ email: loginEmail }).select("name email usn").lean()
          : null;
      const processToSave = withRecruitmentProcessSubmitter(
        sanitized.value,
        req.user,
        studentLean
      );

      await CompanyVisit.updateOne(
        { _id: loaded.visit._id },
        {
          $set: {
            recruitment_process: processToSave,
            migratedAt: new Date(),
          },
        }
      );
      await invalidateCompanyDetailCache(req.params.id);
      await touchCardContentUpdated({
        companyId: req.params.id,
        visitId: loaded.visit._id,
      });

      const out = (
        await getCompanyMergedForAdminById(
          req.params.id,
          y,
          placementListContext,
          companyVisitIdHint,
          placementCluster
        )
      )?.merged;
      return res.json({
        message: "Recruitment process saved.",
        company: out,
      });
    } catch (error) {
      console.error("❌ Error saving recruitment process:", error.message);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

submissionModRouter.delete("/companies/:id/recruitment-process", async (req, res) => {
  try {
    const { y, placementListContext, companyVisitIdHint, placementCluster } =
      adminVisitContextFromReq(req);
    const loaded = await getCompanyMergedForAdminById(
      req.params.id,
      y,
      placementListContext,
      companyVisitIdHint,
      placementCluster
    );
    if (!loaded?.merged) {
      return res.status(404).json({ error: "Company not found" });
    }
    if (!loaded.visit?._id) {
      return res.status(404).json({ error: "Company visit not found for this year." });
    }

    await CompanyVisit.updateOne(
      { _id: loaded.visit._id },
      {
        $unset: { recruitment_process: "" },
        $set: { migratedAt: new Date() },
      }
    );
    await invalidateCompanyDetailCache(req.params.id);
    await touchCardContentUpdated({
      companyId: req.params.id,
      visitId: loaded.visit._id,
    });

    const out = (
      await getCompanyMergedForAdminById(
        req.params.id,
        y,
        placementListContext,
        companyVisitIdHint,
        placementCluster
      )
    )?.merged;
    return res.json({
      message: "Recruitment process removed.",
      company: out,
    });
  } catch (error) {
    console.error("❌ Error deleting recruitment process:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
});

submissionModRouter.delete("/submissions/:id/reject", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (rejectIfSubmissionOutsideAdminCollege(submission, req, res)) return;
    if (await rejectIfSubmissionOutsideSpcCluster(submission, req, res)) return;

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
    if (rejectIfSubmissionOutsideAdminCollege(submission, req, res)) return;

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

// Temporary: read JD PDF and suggest field/section names (no DB write)
adminRouter.post("/jd-import/scan", (req, res, next) => {
  jdPdfUpload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: err.message || "Upload failed",
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "PDF file is required (field name: file)" });
    }

    const roleName = sanitizeText(req.body?.roleName ?? "");
    const { text, numpages, pagesRendered, pagesWithText } =
      await extractTextFromPdfBuffer(req.file.buffer);
    const suggestedFields = await suggestJdFieldNamesWithLlm({ text, roleName });

    res.json({
      roleName,
      suggestedFields,
      pdfPages: numpages ?? null,
      pagesRendered: pagesRendered ?? null,
      pagesWithText: pagesWithText ?? null,
      textChars: text.length,
      rawTextPreview: text,
    });
  } catch (error) {
    console.error("❌ JD scan failed:", error.message);
    const status =
      /empty|enough text|scanned|PDF/i.test(String(error.message || ""))
        ? 400
        : 500;
    res.status(status).json({
      error: status === 400 ? error.message : "Server error",
      details: error.message,
    });
  }
});

// Temporary: extract role fields from a JD PDF (does not write DB)
adminRouter.post("/jd-import/extract", (req, res, next) => {
  jdPdfUpload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: err.message || "Upload failed",
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "PDF file is required (field name: file)" });
    }

    const fields = normalizeExtractFieldNames(req.body?.fields);
    if (fields.length === 0) {
      return res.status(400).json({ error: "fields must be a non-empty JSON array of field names" });
    }

    const roleName = sanitizeText(req.body?.roleName ?? "");
    const { text, numpages, pagesRendered, pagesWithText } =
      await extractTextFromPdfBuffer(req.file.buffer);
    const extracted = await extractJdFieldsWithLlm({
      text,
      fields,
      roleName,
    });

    res.json({
      roleName,
      fields,
      extracted,
      pdfPages: numpages ?? null,
      pagesRendered: pagesRendered ?? null,
      pagesWithText: pagesWithText ?? null,
      textChars: text.length,
      rawTextPreview: text,
    });
  } catch (error) {
    console.error("❌ JD extract failed:", error.message);
    const status =
      /empty|enough text|scanned|field name|PDF/i.test(String(error.message || ""))
        ? 400
        : 500;
    res.status(status).json({
      error: status === 400 ? error.message : "Server error",
      details: error.message,
    });
  }
});

// Temporary: merge reviewed JD fields into company_visits.roles for a year
adminRouter.post("/jd-import/apply", async (req, res) => {
  try {
    const { y, placementListContext, companyVisitIdHint, placementCluster } =
      adminVisitContextFromReq(req);
    const companyId = String(req.body?.companyId || "").trim();
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }

    const visitTypeRaw = req.body?.visitType ?? req.body?.type ?? req.query?.visitType;
    const { type: visitType } = normalizeVisitKeyParts(visitTypeRaw, "");
    if (!visitType) {
      return res.status(400).json({
        error: "visitType is required (e.g. FTE, Internship(PPO), Internship+FTE)",
      });
    }

    const roleName = sanitizeText(req.body?.roleName ?? "");
    // JD imports describe the RVCE drive unless explicitly told otherwise.
    const collegeId = normalizeCollegeId(req.body?.collegeId ?? DEFAULT_COLLEGE_ID);
    const payload =
      req.body?.payload && typeof req.body.payload === "object"
        ? req.body.payload
        : req.body?.extracted && typeof req.body.extracted === "object"
          ? req.body.extracted
          : null;
    if (!payload || Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "payload (extracted fields) is required" });
    }

    const staticRow = await CompanyStatic.findById(companyId).lean();
    if (!staticRow) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Hub key: query/body full programme names ("Computer Science and Engineering") → "cs".
    // Default CS when unset so multi-cluster companies don't write to a random latest visit.
    const clusterHub =
      placementCluster ||
      normalizePlacementClusterQuery(req.body?.placementCluster) ||
      "cs";
    const clusterDbLabel = canonicalVisitClusterLabel(clusterHub);

    /** @type {Record<string, unknown>|null} */
    let freshVisit = null;

    // Exact visit id hint (must match year + cluster + type).
    const hintId = companyVisitIdHint || req.body?.companyVisitId;
    if (hintId && mongoose.Types.ObjectId.isValid(String(hintId))) {
      const hinted = await CompanyVisit.findById(hintId).lean();
      if (
        hinted &&
        visitRowBelongsToCompanyStatic(hinted, staticRow) &&
        normalizeCompanyDetailYear(hinted.year) === y &&
        clusterKeyFromPlacementVisitClusterField(hinted.cluster) === clusterHub &&
        normalizeVisitKeyParts(hinted.type, "").type === visitType
      ) {
        freshVisit = hinted;
      }
    }

    // Resolve by composite key: companyId + year + cluster + type.
    if (!freshVisit) {
      const yearCandidates = await CompanyVisit.find({
        companyId: staticRow._id,
        year: y,
      })
        .sort({ migratedAt: -1, _id: -1 })
        .lean();
      const scoped = yearCandidates.filter(
        (v) => clusterKeyFromPlacementVisitClusterField(v?.cluster) === clusterHub
      );
      freshVisit =
        scoped.find(
          (v) => normalizeVisitKeyParts(v?.type, "").type === visitType
        ) || null;
    }

    // If this hub/year/type has no visit yet, create one with the selected type.
    if (!freshVisit?._id) {
      const created = await CompanyVisit.create({
        companyId: staticRow._id,
        year: y,
        type: visitType,
        cluster: clusterDbLabel,
        roles: [],
        status: "approved",
        migratedAt: new Date(),
      });
      freshVisit = created.toObject ? created.toObject() : created;
    }

    if (!freshVisit?._id) {
      return res.status(404).json({
        error: `Company visit not found for year ${y} / cluster ${clusterHub} / type ${visitType}`,
      });
    }

    // Guard: never write to a different hub/type than requested.
    const visitHub = clusterKeyFromPlacementVisitClusterField(freshVisit.cluster);
    const resolvedType = normalizeVisitKeyParts(freshVisit.type, "").type;
    if (visitHub !== clusterHub) {
      return res.status(409).json({
        error: `Resolved visit cluster is "${visitHub}" but JD import targeted "${clusterHub}". Pick the correct Visit cluster and retry.`,
        visitId: String(freshVisit._id),
        visitCluster: freshVisit.cluster || "",
      });
    }
    if (resolvedType !== visitType) {
      return res.status(409).json({
        error: `Resolved visit type is "${resolvedType || "(empty)"}" but JD import targeted "${visitType}". Pick the correct Visit type and retry.`,
        visitId: String(freshVisit._id),
        visitType: freshVisit.type || "",
      });
    }

    const existingRoles = Array.isArray(freshVisit.roles) ? freshVisit.roles : [];

    // Surgical update only — never replace the whole roles array (that wiped CTC in older code/images).
    const plan = planJdRoleFieldUpdate(existingRoles, roleName, payload, collegeId);
    if (plan.kind === "noop") {
      return res.status(400).json({
        error: "payload must include at least one point field (e.g. skills, workDescription, Bonus Skills)",
      });
    }

    /** @type {Record<string, unknown>} */
    const mongoUpdate = { $set: { migratedAt: new Date() } };
    if (plan.kind === "patch") {
      for (const [key, value] of Object.entries(plan.fields)) {
        mongoUpdate.$set[`roles.${plan.index}.${key}`] = value;
      }
    } else {
      mongoUpdate.$push = { roles: plan.role };
    }

    await CompanyVisit.updateOne({ _id: freshVisit._id }, mongoUpdate);
    await invalidateCompanyDetailCache(companyId);
    await touchCardContentUpdated({ companyId, visitId: freshVisit._id });
    await invalidateVisitRoles2026Cache({
      visitId: freshVisit._id,
      companyId,
    });
    const loaded = await getCompanyMergedForAdminById(
      companyId,
      y,
      placementListContext,
      String(freshVisit._id),
      clusterHub
    );
    const rolesAfterUpdate = loaded?.merged?.roles || [];
    const rolesResponse = (rolesAfterUpdate || []).map((role) => ({
      ...role,
      ctc:
        role && role.ctc instanceof Map
          ? Object.fromEntries(role.ctc)
          : (role && role.ctc) || {},
    }));

    res.json({
      message: "JD fields saved",
      visitId: String(freshVisit._id),
      cluster: clusterHub,
      clusterLabel: clusterDbLabel,
      type: visitType,
      year: y,
      roleName,
      roles: rolesResponse,
    });
  } catch (error) {
    console.error("❌ JD apply failed:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

// Temporary: list company visits missing minCgpa (admin backfill UI)
adminRouter.get("/min-cgpa-gaps", async (req, res) => {
  try {
    const yearRaw = req.query?.year;
    /** @type {Record<string, unknown>} */
    const filter = {
      $or: [{ minCgpa: null }, { minCgpa: { $exists: false } }],
    };
    if (yearRaw != null && String(yearRaw).trim() !== "" && String(yearRaw).toLowerCase() !== "all") {
      filter.year = normalizeCompanyDetailYear(yearRaw);
    }

    const visits = await CompanyVisit.find(filter)
      .select("_id companyId year type cluster eligibility status minCgpa")
      .lean();

    const companyIds = [
      ...new Set(
        visits
          .map((v) => v.companyId)
          .filter(Boolean)
          .map((id) => String(id))
      ),
    ];
    const objectIds = companyIds
      .map((id) => {
        try {
          return new mongoose.Types.ObjectId(id);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const staticRows = objectIds.length
      ? await CompanyStatic.find({ _id: { $in: objectIds } }).select("name").lean()
      : [];
    /** @type {Map<string, string>} */
    const nameById = new Map(
      staticRows.map((row) => [String(row._id), String(row.name || "").trim()])
    );

    const items = visits
      .map((v) => {
        const companyId = String(v.companyId || "");
        const clusterRaw = v.cluster != null ? String(v.cluster) : "";
        const clusterKey = clusterKeyFromPlacementVisitClusterField(clusterRaw) || "cs";
        return {
          visitId: String(v._id),
          companyId,
          companyName: nameById.get(companyId) || "(unknown company)",
          year: v.year ?? null,
          type: v.type != null ? String(v.type) : "",
          cluster: clusterRaw,
          clusterKey,
          clusterLabel:
            PLACEMENT_HUB_CLUSTER_LABELS[clusterKey] ||
            clusterRaw ||
            "Default / legacy (CSE hub)",
          eligibility: v.eligibility != null ? String(v.eligibility) : "",
          status: v.status != null ? String(v.status) : "",
        };
      })
      .sort((a, b) => {
        const byName = a.companyName.localeCompare(b.companyName, undefined, {
          sensitivity: "base",
        });
        if (byName !== 0) return byName;
        const byYear = Number(b.year || 0) - Number(a.year || 0);
        if (byYear !== 0) return byYear;
        return String(a.clusterKey).localeCompare(String(b.clusterKey));
      });

    res.json({ count: items.length, items });
  } catch (error) {
    console.error("❌ min-cgpa-gaps list failed:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

// Temporary: set minCgpa and/or eligibility on a specific company_visits row
adminRouter.put("/min-cgpa-gaps/:visitId", async (req, res) => {
  try {
    const visitId = String(req.params.visitId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(visitId)) {
      return res.status(400).json({ error: "Invalid visitId" });
    }

    /** @type {Record<string, unknown>} */
    const $set = { migratedAt: new Date() };
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const hasMinCgpa = body.minCgpa !== null && body.minCgpa !== undefined && String(body.minCgpa).trim() !== "";
    const hasEligibility = Object.prototype.hasOwnProperty.call(body, "eligibility");

    if (!hasMinCgpa && !hasEligibility) {
      return res.status(400).json({ error: "Provide minCgpa and/or eligibility" });
    }

    if (hasMinCgpa) {
      const n = Number(String(body.minCgpa).trim().replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > 10) {
        return res.status(400).json({ error: "minCgpa must be a number between 0 and 10" });
      }
      $set.minCgpa = Math.round(n * 100) / 100;
    }

    if (hasEligibility) {
      $set.eligibility = String(body.eligibility ?? "");
    }

    const visit = await CompanyVisit.findByIdAndUpdate(
      visitId,
      { $set },
      { new: true }
    ).lean();
    if (!visit) {
      return res.status(404).json({ error: "Company visit not found" });
    }

    await invalidateCompanyDetailCache(visit.companyId);
    await touchCardContentUpdated({ companyId: visit.companyId, visitId: visit._id });

    res.json({
      message: hasMinCgpa && hasEligibility
        ? "minCgpa and eligibility saved"
        : hasMinCgpa
          ? "minCgpa saved"
          : "eligibility saved",
      visitId: String(visit._id),
      companyId: String(visit.companyId),
      minCgpa: visit.minCgpa ?? null,
      eligibility: visit.eligibility != null ? String(visit.eligibility) : "",
      year: visit.year,
      cluster: visit.cluster || "",
    });
  } catch (error) {
    console.error("❌ min-cgpa-gaps update failed:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

const RVITM_COLLEGE_ID = "rvitm";
const RVCE_COLLEGE_ID = "rvce";
const COMPANY_VISITS_WITH_RVITM = "company_visits_with_rvitm";

function readCollegeId(row) {
  if (!row || typeof row !== "object") return "";
  return String(row.collegeId ?? row.college_id ?? "")
    .trim()
    .toLowerCase();
}

function isRvitmCollege(row) {
  return readCollegeId(row) === RVITM_COLLEGE_ID;
}

function stripInternalIds(row) {
  if (!row || typeof row !== "object") return {};
  const { _id, college_id, ...rest } = row;
  return rest;
}

/**
 * Keep non-rvitm rows; tag untagged rows as rvce.
 * Then append the new rvitm rows (always with collegeId: "rvitm").
 */
function mergeCollegeScopedArray(existingRows, rvitmRows, buildRvitmRow) {
  const kept = (Array.isArray(existingRows) ? existingRows : []).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const college = readCollegeId(row);
    if (college === RVITM_COLLEGE_ID) return [];
    const cleaned = stripInternalIds(row);
    return [{ ...cleaned, collegeId: college || RVCE_COLLEGE_ID }];
  });
  const appended = (Array.isArray(rvitmRows) ? rvitmRows : []).map((row) =>
    buildRvitmRow(row)
  );
  return [...kept, ...appended];
}

function normalizeRvitmRole(row) {
  const src = row && typeof row === "object" ? row : {};
  const roleName = String(src.roleName ?? src.role ?? "").trim();
  const out = {
    roleName,
    collegeId: RVITM_COLLEGE_ID,
  };
  if (src.ctc != null && typeof src.ctc === "object" && !Array.isArray(src.ctc)) {
    out.ctc = src.ctc;
  } else if (src.ctc != null && src.ctc !== "") {
    out.ctc = src.ctc;
  } else {
    out.ctc = {};
  }
  if (src.internshipStipend != null && src.internshipStipend !== "") {
    const n = Number(src.internshipStipend);
    if (Number.isFinite(n)) out.internshipStipend = n;
  }
  return out;
}

function normalizeRvitmGotIn(row) {
  const src = row && typeof row === "object" ? row : {};
  const branchCode = String(src.branchCode ?? src.branch ?? "")
    .trim()
    .toLowerCase();
  const gotIn = Math.max(0, Number.parseInt(String(src.gotIn ?? 0), 10) || 0);
  return {
    branchCode,
    gotIn,
    collegeId: RVITM_COLLEGE_ID,
  };
}

function rvitmDataLooksFilled(roles, gotInRows) {
  if ((gotInRows || []).some((g) => Number(g?.gotIn) > 0)) return true;
  return (roles || []).some((r) => {
    const stipend = Number(r?.internshipStipend) > 0;
    const ctc =
      r?.ctc && typeof r.ctc === "object" && !Array.isArray(r.ctc)
        ? Object.keys(r.ctc).length > 0
        : Boolean(r?.ctc);
    return stipend || ctc;
  });
}

// Temporary: list visits from company_visits_with_rvitm that carry rvitm roles/got-in
adminRouter.get("/rvitm-data", async (req, res) => {
  try {
    const yearRaw = req.query?.year;
    /** @type {Record<string, unknown>} */
    const filter = {
      $or: [
        { "roles.collegeId": RVITM_COLLEGE_ID },
        { "roles.college_id": RVITM_COLLEGE_ID },
        { "placementGotInBranchStats.collegeId": RVITM_COLLEGE_ID },
        { "placementGotInBranchStats.college_id": RVITM_COLLEGE_ID },
      ],
    };
    if (
      yearRaw != null &&
      String(yearRaw).trim() !== "" &&
      String(yearRaw).toLowerCase() !== "all"
    ) {
      filter.year = normalizeCompanyDetailYear(yearRaw);
    }

    const db = mongoose.connection.db;
    const sourceVisits = await db
      .collection(COMPANY_VISITS_WITH_RVITM)
      .find(filter)
      .project({
        _id: 1,
        companyId: 1,
        year: 1,
        type: 1,
        cluster: 1,
        roles: 1,
        placementGotInBranchStats: 1,
        status: 1,
      })
      .toArray();

    const companyIds = [
      ...new Set(
        sourceVisits
          .map((v) => v.companyId)
          .filter(Boolean)
          .map((id) => String(id))
      ),
    ];
    const objectIds = companyIds
      .map((id) => {
        try {
          return new mongoose.Types.ObjectId(id);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const staticRows = objectIds.length
      ? await CompanyStatic.find({ _id: { $in: objectIds } }).select("name").lean()
      : [];
    /** @type {Map<string, string>} */
    const nameById = new Map(
      staticRows.map((row) => [String(row._id), String(row.name || "").trim()])
    );

    const items = sourceVisits
      .map((v) => {
        const visitId = String(v._id);
        const companyId = String(v.companyId || "");
        const clusterRaw = v.cluster != null ? String(v.cluster) : "";
        const clusterKey =
          clusterKeyFromPlacementVisitClusterField(clusterRaw) || "cs";
        const sourceRoles = Array.isArray(v.roles) ? v.roles : [];
        const sourceGotIn = Array.isArray(v.placementGotInBranchStats)
          ? v.placementGotInBranchStats
          : [];
        const rvitmRoles = sourceRoles
          .filter(isRvitmCollege)
          .map((row) => {
            const cleaned = stripInternalIds(row);
            return { ...cleaned, collegeId: RVITM_COLLEGE_ID };
          });
        const rvitmGotIn = sourceGotIn
          .filter(isRvitmCollege)
          .map((row) => {
            const cleaned = stripInternalIds(row);
            return {
              branchCode: String(cleaned.branchCode || "").trim().toLowerCase(),
              gotIn: Math.max(0, Number(cleaned.gotIn) || 0),
              collegeId: RVITM_COLLEGE_ID,
            };
          });
        const filled = rvitmDataLooksFilled(rvitmRoles, rvitmGotIn);

        return {
          visitId,
          companyId,
          companyName: nameById.get(companyId) || "(unknown company)",
          year: v.year ?? null,
          type: v.type != null ? String(v.type) : "",
          cluster: clusterRaw,
          clusterKey,
          clusterLabel:
            PLACEMENT_HUB_CLUSTER_LABELS[clusterKey] ||
            clusterRaw ||
            "Default / legacy (CSE hub)",
          status: v.status != null ? String(v.status) : "",
          filled,
          /** @deprecated use filled — kept for older UI builds */
          applied: filled,
          sourceRvitmRoles: rvitmRoles,
          sourceRvitmGotIn: rvitmGotIn,
        };
      })
      .sort((a, b) => {
        if (a.filled !== b.filled) return a.filled ? 1 : -1;
        const byName = a.companyName.localeCompare(b.companyName, undefined, {
          sensitivity: "base",
        });
        if (byName !== 0) return byName;
        return Number(b.year || 0) - Number(a.year || 0);
      });

    res.json({
      count: items.length,
      pending: items.filter((i) => !i.filled).length,
      filled: items.filter((i) => i.filled).length,
      applied: items.filter((i) => i.filled).length,
      items,
    });
  } catch (error) {
    console.error("❌ rvitm-data list failed:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

// Temporary: write rvitm roles + got-in onto company_visits_with_rvitm only
adminRouter.put("/rvitm-data/:visitId", async (req, res) => {
  try {
    const visitId = String(req.params.visitId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(visitId)) {
      return res.status(400).json({ error: "Invalid visitId" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const rolesIn = Array.isArray(body.roles) ? body.roles : null;
    const gotInIn = Array.isArray(body.placementGotInBranchStats)
      ? body.placementGotInBranchStats
      : Array.isArray(body.gotIn)
        ? body.gotIn
        : null;

    if (rolesIn == null && gotInIn == null) {
      return res.status(400).json({
        error: "Provide roles and/or placementGotInBranchStats arrays",
      });
    }

    const db = mongoose.connection.db;
    const col = db.collection(COMPANY_VISITS_WITH_RVITM);
    const oid = new mongoose.Types.ObjectId(visitId);
    const existing = await col.findOne({ _id: oid });
    if (!existing) {
      return res.status(404).json({
        error: "Visit not found in company_visits_with_rvitm",
      });
    }

    /** @type {Record<string, unknown>} */
    const $set = { updatedAt: new Date() };

    if (rolesIn != null) {
      const normalizedRoles = rolesIn
        .map(normalizeRvitmRole)
        .filter((r) => r.roleName);
      if (rolesIn.length > 0 && normalizedRoles.length === 0) {
        return res.status(400).json({ error: "Each rvitm role needs a roleName" });
      }
      $set.roles = mergeCollegeScopedArray(
        existing.roles,
        normalizedRoles,
        (row) => row
      );
    }

    if (gotInIn != null) {
      const normalizedGotIn = gotInIn
        .map(normalizeRvitmGotIn)
        .filter((r) => r.branchCode);
      if (gotInIn.length > 0 && normalizedGotIn.length === 0) {
        return res
          .status(400)
          .json({ error: "Each rvitm got-in row needs a branchCode" });
      }
      $set.placementGotInBranchStats = mergeCollegeScopedArray(
        existing.placementGotInBranchStats,
        normalizedGotIn,
        (row) => row
      );
    }

    await col.updateOne({ _id: oid }, { $set });
    const updated = await col.findOne({ _id: oid });

    if (updated?.companyId) {
      await invalidateCompanyDetailCache(updated.companyId);
      await touchCardContentUpdated({ companyId: updated.companyId, visitId: updated._id });
      if (rolesIn != null) {
        await invalidateVisitRoles2026Cache({
          visitId: updated._id,
          companyId: updated.companyId,
        });
      }
    }

    const roles = Array.isArray(updated?.roles) ? updated.roles : [];
    const gotIn = Array.isArray(updated?.placementGotInBranchStats)
      ? updated.placementGotInBranchStats
      : [];
    const rvitmRoles = roles.filter(isRvitmCollege);
    const rvitmGotIn = gotIn.filter(isRvitmCollege);

    res.json({
      message: "RVITM data saved to company_visits_with_rvitm",
      visitId: String(updated._id),
      companyId: String(updated.companyId),
      rvitmRoles,
      rvitmGotIn,
      filled: rvitmDataLooksFilled(rvitmRoles, rvitmGotIn),
      rolesCount: roles.length,
      gotInCount: gotIn.length,
    });
  } catch (error) {
    console.error("❌ rvitm-data update failed:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

export default adminRouter;

