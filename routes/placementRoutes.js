import express from "express";
import mongoose from "mongoose";
import PlacementData from "../models/PlacementData.js";
import Submission from "../models/Submission.js";
import Student from "../models/Student.js";
import CompanyStatic from "../models/CompanyStatic.js";
import {
  getCompanyMergedForAdminById,
  suggestCompaniesForSpc,
  incrementPpoBranchGotInForAnchoredVisit,
  incrementPlacementAndPpoConvertedForSpcConversionDetails,
  incrementPlacementGotInBranchForAnchoredVisit,
  mapPlacementTypeOfOfferToSpcConversionType,
  resolveApprovedVisitForSpcPlacementOffer,
  syncAnchoredVisitSpcConversionFields,
} from "../services/companyService.js";
import { COMPANY_DETAIL_VISIT_YEARS } from "../utils/placementYears.js";
import { PPO_BRANCH_CODES } from "../utils/ppoBranchCodes.js";
import User1 from "../models/User1.js";
import authJWT from "../middleware/authJWT.js";
import requireSPC from "../middleware/requireSPC.js";
import validateRequest from "../middleware/validateRequest.js";
import {
  placementDataSchema,
  spcConversionDetailsSchema,
  spcCompanySuggestQuerySchema,
  spcSubmitPlacementSchema,
} from "../validations/placement.validation.js";
import { config, messages } from "../config/constants.js";
import { invalidateStudentProfileCacheByEmail } from "../services/studentProfileCache.js";

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

router.get(
  "/spc/company-suggest",
  authJWT,
  requireSPC,
  validateRequest({ querySchema: spcCompanySuggestQuerySchema }),
  async (req, res) => {
    try {
      const { q, limit } = req.query;
      const items = await suggestCompaniesForSpc(q, limit);
      return res.json({ items });
    } catch (error) {
      console.error("❌ Error in SPC company suggest:", error.message);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

/** Escape string for use inside a RegExp source (email-safe). */
function escapeRegexForEmail(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Company-card contribution submissions + placement/conversion rows this SPC filed (`createdBy`).
 */
router.get("/spc/my-submissions", authJWT, requireSPC, async (req, res) => {
  try {
    const email = String(req.user?.email || "").trim().toLowerCase();
    const userId = String(req.user?._id || req.user?.id || "").trim();

    const contributionFilter = email
      ? {
          "submittedBy.email": {
            $regex: new RegExp(`^${escapeRegexForEmail(email)}$`, "i"),
          },
        }
      : { _id: null };

    const createdByOr = [];
    if (userId) createdByOr.push({ createdBy: userId });
    if (email) {
      createdByOr.push({ createdBy: email });
      createdByOr.push({
        createdBy: { $regex: new RegExp(`^${escapeRegexForEmail(email)}$`, "i") },
      });
    }
    const placementFilter =
      createdByOr.length > 0 ? { $or: createdByOr } : { _id: null };

    const [contributionsRaw, placementRaw] = await Promise.all([
      Submission.find(contributionFilter)
        .sort({ submittedAt: -1, _id: -1 })
        .populate("companyId", "name")
        .limit(200)
        .lean(),
      PlacementData.find(placementFilter)
        .sort({ updatedAt: -1 })
        .populate("companyId", "name")
        .populate("studentId", "name email usn")
        .limit(200)
        .lean(),
    ]);

    const contributions = contributionsRaw.map((s) => ({
      _id: String(s._id),
      kind: "company_contribution",
      type: s.type,
      status: s.status,
      submittedAt: s.submittedAt,
      placementYear: s.placementYear ?? null,
      placementListContext: s.placementListContext ?? null,
      companyId: s.companyId?._id ? String(s.companyId._id) : null,
      companyName: s.companyId?.name || "Unknown company",
      contentPreview: String(s.content || "").slice(0, 200),
    }));

    const placements = placementRaw.map((p) => ({
      _id: String(p._id),
      kind: "placement_record",
      companyPlaced: p.companyPlaced,
      companyId: p.companyId?._id ? String(p.companyId._id) : null,
      companyName: p.companyId?.name || p.companyPlaced || "—",
      placementYear: p.placementYear ?? null,
      branchCode: p.branchCode || "",
      typeOfOffer: p.typeOfOffer || "",
      role: p.role || "",
      stipend: p.stipend || "",
      base: p.base || "",
      ctc: p.ctc || "",
      studentName: p.studentId?.name || "—",
      studentEmail: p.studentId?.email || "",
      studentUsn: p.studentId?.usn || "",
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      createdBy: p.createdBy || "",
    }));

    return res.json({ contributions, placements });
  } catch (error) {
    console.error("❌ Error fetching SPC my-submissions:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/spc/conversion-details",
  authJWT,
  requireSPC,
  validateRequest(spcConversionDetailsSchema),
  async (req, res) => {
    try {
      const {
        companyId,
        placementYear,
        branchCode,
        email: emailRaw,
        name: nameRaw,
        usn: usnRaw,
        conversionType,
        ctc,
        base,
        stipend,
        role: roleRaw,
        placementContext: placementContextBody,
        placementListContext: placementListContextBody,
      } = req.body;
      const placementCtxForVisit =
        String(placementContextBody ?? placementListContextBody ?? "")
          .trim() || null;

      const email = String(emailRaw || "").trim().toLowerCase();
      const name = String(nameRaw || "").trim();
      const usn = String(usnRaw || "").trim().toUpperCase();
      const typeOfOffer = conversionType === "fte_internship" ? "Internship+FTE" : "FTE";
      const stipendVal =
        conversionType === "fte_internship" ? String(stipend ?? "").trim() : "";
      const roleTrim = String(roleRaw ?? "").trim();
      const ctcTrim = String(ctc ?? "").trim();
      const baseTrim = String(base ?? "").trim();
      const branchLower = String(branchCode || "").trim().toLowerCase();

      const visitSyncFields = {
        conversionType,
        role: roleTrim,
        ctc: ctcTrim,
        base: baseTrim,
        stipend: stipendVal,
      };

      if (!email) {
        return res.status(400).json({ message: "Email of student is required" });
      }
      if (!name) {
        return res.status(400).json({ message: "Name is required" });
      }
      if (!usn) {
        return res.status(400).json({ message: "USN is required" });
      }

      const companyRow = await CompanyStatic.findById(companyId).select("name").lean();
      if (!companyRow?.name) {
        return res.status(404).json({ message: "Company not found" });
      }
      const companyPlaced = String(companyRow.name).trim();

      let cid;
      try {
        cid = new mongoose.Types.ObjectId(String(companyId));
      } catch {
        return res.status(400).json({ message: "Invalid company id" });
      }

      let resolvedVisitResult = await resolveApprovedVisitForSpcPlacementOffer(
        String(cid),
        placementYear,
        typeOfOffer,
        placementCtxForVisit
      );
      // FTE / Internship+FTE rows may be absent while an on-campus PPO visit row holds the same cycle.
      if (!resolvedVisitResult.ok) {
        const ppoAnchor = await resolveApprovedVisitForSpcPlacementOffer(
          String(cid),
          placementYear,
          "Internship(PPO)",
          placementCtxForVisit
        );
        if (ppoAnchor.ok) {
          resolvedVisitResult = ppoAnchor;
        }
      }
      if (!resolvedVisitResult.ok) {
        return res.status(400).json({
          message:
            resolvedVisitResult.message ||
            "Could not locate a matching approved visit for this offer and hub.",
        });
      }
      const resolvedVisit = resolvedVisitResult.visit;

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

      const createdBy = String(req.user?.id || req.user?._id || req.user?.email || "");

      const existing = await PlacementData.findOne({
        studentId: student._id,
        companyId: cid,
        placementYear,
      }).lean();

      if (existing) {
        await PlacementData.findByIdAndUpdate(existing._id, {
          companyPlaced,
          typeOfOffer,
          stipend: stipendVal,
          base: baseTrim,
          ctc: ctcTrim,
          role: roleTrim,
          branchCode: branchLower,
          createdBy,
        });
        const visitSync = await syncAnchoredVisitSpcConversionFields(
          companyId,
          placementYear,
          visitSyncFields,
          placementCtxForVisit,
          { resolvedVisit }
        );
        if (!visitSync.ok) {
          console.warn("SPC conversion-details: visit extras sync failed:", visitSync.reason);
        }
        await invalidateStudentProfileCacheByEmail(email).catch(() => {});
        return res.json({
          message: "Conversion details updated",
          studentId: student._id,
          placementId: existing._id,
          branchConvertedIncremented: false,
        });
      }

      let placement;
      try {
        placement = await PlacementData.create({
          studentId: student._id,
          companyPlaced,
          typeOfOffer,
          stipend: stipendVal,
          base: baseTrim,
          ctc: ctcTrim,
          role: roleTrim,
          companyId: cid,
          placementYear,
          branchCode: branchLower,
          createdBy,
        });
      } catch (createErr) {
        if (createErr?.code === 11000) {
          const raced = await PlacementData.findOne({
            studentId: student._id,
            companyId: cid,
            placementYear,
          }).lean();
          if (raced) {
            await PlacementData.findByIdAndUpdate(raced._id, {
              companyPlaced,
              typeOfOffer,
              stipend: stipendVal,
              base: baseTrim,
              ctc: ctcTrim,
              role: roleTrim,
              branchCode: branchLower,
              createdBy,
            });
            const visitSyncRace = await syncAnchoredVisitSpcConversionFields(
              companyId,
              placementYear,
              visitSyncFields,
              placementCtxForVisit,
              { resolvedVisit }
            );
            if (!visitSyncRace.ok) {
              console.warn(
                "SPC conversion-details: visit extras sync failed:",
                visitSyncRace.reason
              );
            }
            await invalidateStudentProfileCacheByEmail(email).catch(() => {});
            return res.json({
              message: "Conversion details updated",
              studentId: student._id,
              placementId: raced._id,
              branchConvertedIncremented: false,
            });
          }
        }
        throw createErr;
      }

      const inc = await incrementPlacementAndPpoConvertedForSpcConversionDetails(
        companyId,
        placementYear,
        branchCode,
        1,
        1,
        visitSyncFields,
        placementCtxForVisit,
        { resolvedVisit }
      );
      if (!inc.ok) {
        await PlacementData.deleteOne({ _id: placement._id });
        return res.status(500).json({
          message: "Failed to update company visit (placement got-in / PPO conversion stats)",
        });
      }

      await invalidateStudentProfileCacheByEmail(email).catch(() => {});

      return res.json({
        message: "Conversion details saved",
        studentId: student._id,
        placementId: placement._id,
        branchPlacementGotInIncremented: true,
        ppoBranchConvertedIncremented: true,
      });
    } catch (error) {
      console.error("❌ Error submitting SPC conversion details:", error.message);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

router.post(
  "/spc/submit",
  authJWT,
  requireSPC,
  validateRequest({ bodySchema: spcSubmitPlacementSchema }),
  async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = String(req.body?.name || "").trim();
    const usn = String(req.body?.usn || "").trim().toUpperCase();
    const companyPlaced = String(req.body?.companyPlaced || "").trim();
    const typeOfOffer = String(req.body?.typeOfOffer || "").trim();
    const stipend = String(req.body?.stipend ?? "").trim();
    const base = String(req.body?.base ?? "").trim();
    const ctc = String(req.body?.ctc ?? "").trim();
    const roleRaw = String(req.body?.role ?? "").trim();
    const companyIdRaw = String(req.body?.companyId || "").trim();
    const placementYearRaw = req.body?.placementYear;
    const branchCodeRaw = String(req.body?.branchCode || "").trim().toLowerCase();
    const placementCtxForVisit =
      String(req.body?.placementContext ?? req.body?.placementListContext ?? "")
        .trim() || null;

    let cid = null;
    if (companyIdRaw && mongoose.Types.ObjectId.isValid(companyIdRaw)) {
      cid = new mongoose.Types.ObjectId(companyIdRaw);
    }
    const placementYearNum = Number(placementYearRaw);
    const yearOk =
      Number.isInteger(placementYearNum) &&
      COMPANY_DETAIL_VISIT_YEARS.includes(placementYearNum);
    const branchOk = Boolean(branchCodeRaw && PPO_BRANCH_CODES.has(branchCodeRaw));
    const wantsVisitBump = Boolean(cid && yearOk && branchOk);

    if (companyIdRaw && (!cid || !yearOk || !branchOk)) {
      return res.status(400).json({
        message:
          "When company ID is provided, placementYear (2026–2028) and a valid branchCode are required to update visit stats.",
      });
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

    const createdBy = String(req.user?.id || req.user?._id || req.user?.email || "");

    if (wantsVisitBump) {
      const dupVisit = await PlacementData.findOne({
        studentId: student._id,
        companyId: cid,
        placementYear: placementYearNum,
      }).lean();
      if (dupVisit) {
        await invalidateStudentProfileCacheByEmail(email).catch(() => {});
        return res.status(400).json({
          message: "Duplicate entry for this student, company, and placement year",
        });
      }

      const resolvedSubmit = await resolveApprovedVisitForSpcPlacementOffer(
        companyIdRaw,
        placementYearNum,
        typeOfOffer,
        placementCtxForVisit
      );
      if (!resolvedSubmit.ok) {
        return res.status(400).json({
          message:
            resolvedSubmit.message ||
            "Could not locate a matching approved visit for this offer and hub.",
        });
      }
      const resolvedVisitSubmit = resolvedSubmit.visit;

      const placement = await PlacementData.create({
        studentId: student._id,
        companyPlaced,
        typeOfOffer,
        stipend,
        base,
        ctc,
        companyId: cid,
        placementYear: placementYearNum,
        branchCode: branchCodeRaw,
        createdBy,
      });

      const typeNorm = typeOfOffer.replace(/\s+/g, " ").trim().toLowerCase();
      const isPpoOffer = typeNorm === "internship(ppo)";

      const inc = isPpoOffer
        ? await incrementPpoBranchGotInForAnchoredVisit(
            companyIdRaw,
            placementYearNum,
            branchCodeRaw,
            1,
            0,
            {
              placementListContext: placementCtxForVisit,
              resolvedVisit: resolvedVisitSubmit,
            }
          )
        : await incrementPlacementGotInBranchForAnchoredVisit(
            companyIdRaw,
            placementYearNum,
            branchCodeRaw,
            1,
            placementCtxForVisit,
            { resolvedVisit: resolvedVisitSubmit }
          );

      if (!inc.ok) {
        await PlacementData.deleteOne({ _id: placement._id });
        return res.status(500).json({ message: "Failed to update company visit placement stats" });
      }

      const placementConvType = mapPlacementTypeOfOfferToSpcConversionType(typeOfOffer);
      const stipendForVisitSync =
        placementConvType === "fte_internship"
          ? stipend
          : placementConvType === "fte"
            ? ""
            : stipend;
      const visitSyncFields = {
        conversionType: placementConvType,
        role: roleRaw,
        ctc,
        base,
        stipend: stipendForVisitSync,
      };
      const visitSync = await syncAnchoredVisitSpcConversionFields(
        companyIdRaw,
        placementYearNum,
        visitSyncFields,
        placementCtxForVisit,
        { resolvedVisit: resolvedVisitSubmit }
      );
      if (!visitSync.ok) {
        console.warn("SPC placement submit: visit compensation sync failed:", visitSync.reason);
      }

      await invalidateStudentProfileCacheByEmail(email).catch(() => {});

      return res.json({
        message: "Placement data submitted successfully",
        studentId: student._id,
        placementId: placement._id,
        visitStatsIncremented: true,
      });
    }

    const duplicate = await PlacementData.findOne({
      studentId: student._id,
      companyPlaced,
      typeOfOffer,
    });

    if (duplicate) {
      await invalidateStudentProfileCacheByEmail(email).catch(() => {});
      return res.status(400).json({ message: "Duplicate entry" });
    }

    const placement = await PlacementData.create({
      studentId: student._id,
      companyPlaced,
      typeOfOffer,
      stipend,
      base,
      ctc,
      createdBy,
    });

    await invalidateStudentProfileCacheByEmail(email).catch(() => {});

    return res.json({
      message: "Placement data submitted successfully",
      studentId: student._id,
      placementId: placement._id,
      visitStatsIncremented: false,
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

