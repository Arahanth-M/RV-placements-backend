import express from "express";
import authJWT from "../middleware/authJWT.js";
import authorize from "../middleware/authorize.js";
import requireAdmin from "../middleware/requireAdmin.js";
import validateRequest from "../middleware/validateRequest.js";
import {
  adminOaQuestionUpdateSchema,
  adminInterviewQuestionUpdateSchema,
  adminInterviewProcessUpdateSchema,
  adminCompanyStatsSchema,
  adminCompanyTotalGotInAdjustmentSchema,
  adminCompanyRolesSchema,
  adminCompanyGeneralSchema,
  adminMissingCompanyStatusSchema,
} from "../validations/admin.validation.js";
import User from "../models/User.js";
import Submission from "../models/Submission.js";
import CompanyStatic from "../models/CompanyStatic.js";
import MissingCompany from "../models/MissingCompany.js";
import Notification from "../models/Notification.js";
import { getAdminStats } from "../controllers/adminStatsController.js";
import { invalidateAdminDashboardStatsCache } from "../services/adminDashboardStatsCache.js";
import { invalidateCompanyDetailCache } from "../services/companyDetailCache.js";
import {
  approveAndNormalizeCompanyVisit,
  adjustVisitTotalGotIn,
  deleteCompanyVisitForYear,
  deleteSplitCompany,
  ensureAdminVisitForYear,
  getCompanyMergedForAdminById,
  listAdminPaginatedCompaniesFromSplit,
  normalizeCompanyDetailYear,
  persistMergedCompany,
  updateCompanyStatic,
  updateCompanyVisit,
} from "../services/companyService.js";
import { invalidateLeaderboardCache } from "./leaderboardRoutes.js";

const adminRouter = express.Router();

// All admin routes: JWT → RBAC (admin role) → legacy admin session check
adminRouter.use(authJWT);
adminRouter.use(authorize(["admin"]));
adminRouter.use(requireAdmin);

/** Placement year for admin visit reads/writes (`?year=2026|2027`, default 2026). */
function adminVisitYearFromQuery(req) {
  return normalizeCompanyDetailYear(req.query?.year);
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
    };
  }
  if (status === "pending") {
    return {
      _id: merged._id,
      name: merged.name,
      type: merged.type,
      offCampus: merged.offCampus,
      count: merged.count,
      status: merged.status,
      createdAt: merged.createdAt,
      updatedAt: merged.updatedAt,
      submittedBy: merged.submittedBy,
      interviewExperience: merged.internshipExperience ?? merged.interviewExperience,
      interviewQuestions: merged.interviewQuestions,
      onlineQuestions: merged.onlineQuestions,
      Must_Do_Topics: merged.Must_Do_Topics,
      placementYear: merged.placementYear ?? null,
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

const PPO_BRANCH_CODES = new Set(["cd", "cy", "ise", "cse", "aiml", "bt"]);

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

// Paginated submissions list (trimmed content for table rows; use GET /submissions/:id for full body)
adminRouter.get("/submissions", async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const { page, limit, skip } = parseAdminPagination(req.query);

    const [total, docs] = await Promise.all([
      Submission.countDocuments(query),
      Submission.find(query)
        .populate({ path: "companyId", select: "name", model: "CompanyStatic" })
        .select("companyId type submittedBy isAnonymous status submittedAt approvedAt content")
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
    ]);

    const items = docs.map(mapSubmissionListRow);
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
adminRouter.get("/submissions/:id", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id).populate({ path: "companyId", select: "name", model: "CompanyStatic" });
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    res.json(submission);
  } catch (error) {
    console.error("❌ Error fetching submission:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Get dashboard stats (Redis-cached when REDIS_URL is set; invalidated on admin mutations)
adminRouter.get("/stats", getAdminStats);

adminRouter.get("/missing-companies", async (req, res) => {
  try {
    const missingCompanies = await MissingCompany.find({})
      .populate("requestedBy", "_id username email")
      .sort({ requestCount: -1, createdAt: -1 })
      .lean();

    res.json({ items: missingCompanies });
  } catch (error) {
    console.error("❌ Error fetching missing companies:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.patch(
  "/missing-companies/:id/status",
  validateRequest(adminMissingCompanyStatusSchema),
  async (req, res) => {
    try {
      const missingCompany = await MissingCompany.findByIdAndUpdate(
        req.params.id,
        { $set: { status: req.body.status } },
        { new: true, runValidators: true }
      );

      if (!missingCompany) {
        return res.status(404).json({ error: "Missing company request not found" });
      }

      return res.json({
        message: "Missing company status updated successfully",
        missingCompany,
      });
    } catch (error) {
      console.error("❌ Error updating missing company status:", error.message);
      if (error.name === "CastError") {
        return res.status(404).json({ error: "Missing company request not found" });
      }
      return res.status(500).json({ error: "Server error" });
    }
  }
);

adminRouter.delete("/missing-companies/:id", async (req, res) => {
  try {
    const missingCompany = await MissingCompany.findByIdAndDelete(req.params.id);

    if (!missingCompany) {
      return res.status(404).json({ error: "Missing company request not found" });
    }

    return res.json({ message: "Missing company request deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting missing company request:", error.message);
    if (error.name === "CastError") {
      return res.status(404).json({ error: "Missing company request not found" });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

// Approve submission and update company
adminRouter.post("/submissions/:id/approve", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const placementYear = normalizeCompanyDetailYear(submission.placementYear);
    await ensureAdminVisitForYear(submission.companyId, placementYear);
    const loadedForSub = await getCompanyMergedForAdminById(
      String(submission.companyId),
      placementYear
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

    // Parse submission content
    let parsedContent;
    try {
      parsedContent = JSON.parse(submission.content);
    } catch {
      parsedContent = { question: submission.content, solution: "" };
    }

    // Update company based on submission type
    if (submission.type === "onlineQuestions") {
      // Ensure we get a string value
      let questionText = parsedContent.question || submission.content;
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
      let questionText = parsedContent.question || submission.content;
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
      let processText = parsedContent.question || parsedContent.content || submission.content;
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
    } else if (submission.type === "mustDoTopics") {
      // Ensure we get a string value
      let topicText = parsedContent.question || parsedContent.content || parsedContent.topic || submission.content;
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
      await persistMergedCompany(String(submission.companyId), merged, placementYear);
      console.log("✅ Company updated successfully:", submission.companyId);
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
    await submission.save();

    // Award leaderboard points: question = 5, interview experience = 10
    const POINTS_QUESTION = 5;
    const POINTS_INTERVIEW_EXPERIENCE = 10;
    const pointsToAdd =
      submission.type === "interviewProcess"
        ? POINTS_INTERVIEW_EXPERIENCE
        : POINTS_QUESTION; // onlineQuestions, interviewQuestions, mustDoTopics

    const contributor = await User.findOne({ email: submission.submittedBy?.email });
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
      placementYear
    );
    const companyOut = reloadedSub?.merged
      ? companyToJsonSafePlainObject(reloadedSub.merged)
      : null;

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

// Approve a company
adminRouter.post("/companies/:id/approve", async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const loaded = await getCompanyMergedForAdminById(req.params.id, y);
    if (!loaded || !loaded.staticRow) {
      return res.status(404).json({ error: "Company not found" });
    }
    if (loaded.merged?.status === "approved") {
      return res.json({
        message: "Company already approved",
        company: companyToJsonSafePlainObject(loaded.merged),
        alreadyApproved: true,
      });
    }

    const approvedAt = new Date();
    await approveAndNormalizeCompanyVisit(req.params.id, y, approvedAt);

    try {
      await invalidateAdminDashboardStatsCache();
    } catch (cacheErr) {
      console.warn("⚠️ Failed to invalidate admin dashboard cache after company approval:", cacheErr?.message || cacheErr);
    }

    const out = (await getCompanyMergedForAdminById(req.params.id, y))?.merged ?? null;
    res.json({
      message: "Company approved successfully",
      company: out ? companyToJsonSafePlainObject(out) : null,
      alreadyApproved: false,
    });
  } catch (error) {
    console.error("❌ Error approving company:", error?.message || error);
    console.error("❌ Error name:", error?.name);
    console.error("❌ Error stack:", error?.stack);
    res.status(500).json({ error: "Server error" });
  }
});

// Reject a pending company visit for the selected year
adminRouter.delete("/companies/:id/reject", async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const loaded = await getCompanyMergedForAdminById(req.params.id, y);
    if (!loaded || !loaded.staticRow) {
      return res.status(404).json({ error: "Company not found" });
    }
    if (!loaded.visit) {
      return res.status(404).json({ error: "Company visit not found for selected year" });
    }
    if (loaded.merged?.status === "approved") {
      return res.status(400).json({
        error: "Approved companies must be removed using the delete endpoint",
      });
    }

    await deleteCompanyVisitForYear(req.params.id, y);

    await invalidateAdminDashboardStatsCache();

    res.json({ message: "Company visit rejected successfully" });
  } catch (error) {
    console.error("❌ Error rejecting company:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Delete an approved company visit for the selected year
adminRouter.delete("/companies/:id/delete", async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const loaded = await getCompanyMergedForAdminById(req.params.id, y);
    if (!loaded || !loaded.staticRow) {
      return res.status(404).json({ error: "Company not found" });
    }
    if (!loaded.visit) {
      return res.status(404).json({ error: "Company visit not found for selected year" });
    }
    if (loaded.merged?.status !== "approved") {
      return res.status(400).json({ error: "Only approved companies can be deleted using this endpoint" });
    }

    await deleteCompanyVisitForYear(req.params.id, y);

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

// PUT /api/admin/companies/:id/stats - update placement stats (admin only)
adminRouter.put(
  "/companies/:id/stats",
  validateRequest(adminCompanyStatsSchema),
  async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
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
      ppoBranchStats,
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
        if (Number.isNaN(gotIn) || gotIn < 0 || Number.isNaN(converted) || converted < 0) {
          return res.status(400).json({ error: `Invalid stats for branch: ${code}` });
        }
        normalized.push({ branchCode: code, gotIn, converted });
      }
      payload.ppoBranchStats = normalized;
      const gotInTotal = normalized.reduce((sum, item) => sum + (item.gotIn || 0), 0);
      const convertedTotal = normalized.reduce((sum, item) => sum + (item.converted || 0), 0);
      payload.ppoConversionGotIn = gotInTotal;
      payload.ppoConversionConverted = convertedTotal;
      payload.ppoConversionAcceptanceRate =
        gotInTotal > 0 ? Number(((convertedTotal / gotInTotal) * 100).toFixed(2)) : 0;
    }

    const hasGotIn = payload.ppoConversionGotIn !== undefined;
    const hasConverted = payload.ppoConversionConverted !== undefined;
    if (hasGotIn || hasConverted) {
      let existingStats = null;
      if (!hasGotIn || !hasConverted) {
        existingStats = (await getCompanyMergedForAdminById(req.params.id, y))?.merged || null;
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
    await updateCompanyVisit(req.params.id, payload, y);
    const out = (await getCompanyMergedForAdminById(req.params.id, y))?.merged;
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
      const delta = Number(req.body?.delta);
      await ensureAdminVisitForYear(req.params.id, y);
      const gotInDoc = await adjustVisitTotalGotIn(req.params.id, delta, y);
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

      const internshipStipend =
        role.internshipStipend !== undefined && role.internshipStipend !== null
          ? Number(role.internshipStipend)
          : undefined;
      if (
        internshipStipend !== undefined &&
        (Number.isNaN(internshipStipend) || internshipStipend < 0)
      ) {
        throw new Error(
          `Role "${roleName}": internshipStipend must be a non‑negative number`
        );
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

      return {
        roleName,
        ctc,
        ...(internshipStipend !== undefined ? { internshipStipend } : {}),
      };
    });

    const staticRow = await CompanyStatic.findById(req.params.id).lean();
    if (!staticRow) {
      return res.status(404).json({ error: "Company not found" });
    }
    await ensureAdminVisitForYear(req.params.id, y);
    await updateCompanyVisit(req.params.id, { roles: normalizedRoles }, y);
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

// Update general company info (eligibility, business model, type, offCampus)
adminRouter.put(
  "/companies/:id/general",
  validateRequest(adminCompanyGeneralSchema),
  async (req, res) => {
  try {
    const y = adminVisitYearFromQuery(req);
    const { eligibility, business_model, type, offCampus } = req.body || {};

    const updateData = {};
    if (eligibility !== undefined) updateData.eligibility = sanitizeText(eligibility);
    if (business_model !== undefined) updateData.business_model = sanitizeText(business_model);
    if (type !== undefined) updateData.type = sanitizeText(type);
    if (offCampus !== undefined) updateData.offCampus = Boolean(offCampus);

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
adminRouter.delete("/submissions/:id/reject", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Delete the submission
    await Submission.findByIdAndDelete(req.params.id);
    
    console.log('✅ Submission rejected and deleted:', req.params.id);
    
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

