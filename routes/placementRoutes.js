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
  spcUpdatePlacementSchema,
} from "../validations/placement.validation.js";
import { config, messages } from "../config/constants.js";
import { invalidateStudentProfileCacheByEmail } from "../services/studentProfileCache.js";
import { invalidateMySubmissionsCacheByEmail } from "../services/mySubmissionsCache.js";
import {
  getCachedSpcMyRecords,
  setCachedSpcMyRecords,
  loadSpcMyRecordsFromDb,
  invalidateSpcMyRecordsCacheByEmail,
} from "../services/spcMyRecordsCache.js";
import { invalidateStudentPlacementStatsCache } from "../services/studentPlacementStatsCache.js";

async function invalidateSpcCachesForUser(user) {
  const email = String(user?.email || "").trim();
  await Promise.all([
    invalidateMySubmissionsCacheByEmail(email),
    invalidateSpcMyRecordsCacheByEmail(email),
    invalidateStudentPlacementStatsCache(),
  ]);
}

async function invalidatePlacementStatsAfterWrite() {
  await invalidateStudentPlacementStatsCache().catch(() => {});
}

const router = express.Router();

/** Escape string for case-insensitive exact match on {@link PlacementData.companyPlaced}. */
function escapeRegexForExactMatch(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const LEGACY_PPO_TYPE_REGEX = /^internship\s*\(ppo\)$/i;

function normalizeOfferType(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isPpoOfferType(value) {
  return normalizeOfferType(value) === "internship(ppo)";
}

async function resolveCompanyIdForPlacementName(companyPlacedRaw) {
  const companyPlaced = String(companyPlacedRaw || "").trim();
  if (!companyPlaced) return null;
  const nameRegex = new RegExp(`^${escapeRegexForExactMatch(companyPlaced)}$`, "i");
  const row = await CompanyStatic.findOne({ name: nameRegex }).select("_id").lean();
  return row?._id || null;
}

/**
 * Locate an existing Internship(PPO) placement row for conversion append.
 * Legacy `/spc/submit` rows often omit `companyId`; match those by canonical company name.
 */
async function findPlacementRowForSpcConversionDetails(
  studentObjectId,
  companyObjectId,
  placementYear,
  companyPlacedCanonical
) {
  const sid = studentObjectId;
  const cid = companyObjectId;
  const year = placementYear;
  const name = String(companyPlacedCanonical || "").trim();
  const nameRegex = name ? new RegExp(`^${escapeRegexForExactMatch(name)}$`, "i") : null;

  const keyed = await PlacementData.findOne({
    studentId: sid,
    companyId: cid,
    placementYear: year,
    typeOfOffer: LEGACY_PPO_TYPE_REGEX,
  })
    .sort({ updatedAt: -1 })
    .lean();
  if (keyed) return { doc: keyed, matchKind: "keyed" };

  if (!nameRegex) return { doc: null, matchKind: "none" };

  const byNameYear = await PlacementData.findOne({
    studentId: sid,
    placementYear: year,
    companyPlaced: nameRegex,
    typeOfOffer: LEGACY_PPO_TYPE_REGEX,
  })
    .sort({ updatedAt: -1 })
    .lean();
  if (byNameYear) return { doc: byNameYear, matchKind: "legacy_name_year" };

  const byNameMissingYear = await PlacementData.findOne({
    studentId: sid,
    companyPlaced: nameRegex,
    typeOfOffer: LEGACY_PPO_TYPE_REGEX,
    $or: [{ placementYear: null }, { placementYear: { $exists: false } }],
  })
    .sort({ updatedAt: -1 })
    .lean();
  if (byNameMissingYear) return { doc: byNameMissingYear, matchKind: "legacy_name_missing_year" };

  return { doc: null, matchKind: "none" };
}

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

    await invalidateSpcCachesForUser(req.user);

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

router.put(
  "/spc/placements/:placementId",
  authJWT,
  requireSPC,
  validateRequest({ bodySchema: spcUpdatePlacementSchema }),
  async (req, res) => {
    try {
      const placementId = String(req.params?.placementId || "").trim();
      if (!placementId || !mongoose.Types.ObjectId.isValid(placementId)) {
        return res.status(400).json({ message: "Invalid placement id" });
      }

      const placement = await PlacementData.findById(placementId).lean();
      if (!placement) {
        return res.status(404).json({ message: "Placement record not found" });
      }

      const email = String(req.user?.email || "").trim().toLowerCase();
      const userId = String(req.user?._id || req.user?.id || "").trim();
      const createdByRaw = String(placement.createdBy || "").trim();
      const createdByLower = createdByRaw.toLowerCase();
      const canEdit =
        (userId && createdByRaw === userId) || (email && createdByLower === email);
      if (!canEdit) {
        return res.status(403).json({
          message: "You can edit only placement records submitted by your account.",
        });
      }

      const payload = {};
      if (req.body.companyPlaced !== undefined) {
        payload.companyPlaced = String(req.body.companyPlaced ?? "").trim();
      }
      if (req.body.typeOfOffer !== undefined) {
        payload.typeOfOffer = String(req.body.typeOfOffer ?? "").trim();
      }
      if (req.body.placementYear !== undefined) {
        payload.placementYear =
          req.body.placementYear == null ? null : Number(req.body.placementYear);
      }
      if (req.body.branchCode !== undefined) {
        payload.branchCode = String(req.body.branchCode ?? "").trim().toLowerCase();
      }
      if (req.body.role !== undefined) payload.role = String(req.body.role ?? "").trim();
      if (req.body.stipend !== undefined) payload.stipend = String(req.body.stipend ?? "").trim();
      if (req.body.base !== undefined) payload.base = String(req.body.base ?? "").trim();
      if (req.body.ctc !== undefined) payload.ctc = String(req.body.ctc ?? "").trim();
      if (req.body.ppoConversionType !== undefined) {
        payload.ppoConversionType = String(req.body.ppoConversionType ?? "").trim();
      }
      if (req.body.sixMonthsInternshipStipend !== undefined) {
        payload["6-months-internship-stipend"] = String(
          req.body.sixMonthsInternshipStipend ?? ""
        ).trim();
      }
      if (payload.companyPlaced !== undefined) {
        const resolvedCompanyId = await resolveCompanyIdForPlacementName(payload.companyPlaced);
        payload.companyId = resolvedCompanyId;
      }

      if (Object.keys(payload).length === 0) {
        const hasStudentEdits =
          req.body.studentName !== undefined ||
          req.body.studentEmail !== undefined ||
          req.body.studentUsn !== undefined;
        if (!hasStudentEdits) {
          return res.status(400).json({ message: "No editable fields provided" });
        }
      }

      payload.createdBy = String(req.user?.id || req.user?._id || req.user?.email || "");

      const previousStudent = await Student.findById(placement.studentId).lean();
      let nextStudentEmail = String(previousStudent?.email || "").trim().toLowerCase();
      if (
        req.body.studentName !== undefined ||
        req.body.studentEmail !== undefined ||
        req.body.studentUsn !== undefined
      ) {
        const studentDoc = await Student.findById(placement.studentId);
        if (studentDoc) {
          if (req.body.studentName !== undefined) {
            studentDoc.name = String(req.body.studentName ?? "").trim();
          }
          if (req.body.studentEmail !== undefined) {
            studentDoc.email = String(req.body.studentEmail ?? "").trim().toLowerCase();
          }
          if (req.body.studentUsn !== undefined) {
            studentDoc.usn = String(req.body.studentUsn ?? "").trim().toUpperCase();
          }
          await studentDoc.save();
          nextStudentEmail = String(studentDoc.email || "").trim().toLowerCase();
        }
      }

      const previousCompanyId = placement.companyId ? String(placement.companyId) : "";
      const previousPlacementYear = placement.placementYear ?? null;
      const previousBranchCode = String(placement.branchCode || "").trim().toLowerCase();
      const previousTypeOfOffer = String(placement.typeOfOffer || "").trim();

      await PlacementData.findByIdAndUpdate(placementId, payload);

      const nextCompanyIdRaw =
        payload.companyId !== undefined ? payload.companyId : placement.companyId;
      const nextCompanyId = nextCompanyIdRaw ? String(nextCompanyIdRaw) : "";
      const nextPlacementYear =
        payload.placementYear !== undefined ? payload.placementYear : placement.placementYear;
      const nextBranchCode = String(
        payload.branchCode !== undefined ? payload.branchCode : placement.branchCode || ""
      )
        .trim()
        .toLowerCase();
      const nextTypeOfOffer = String(
        payload.typeOfOffer !== undefined ? payload.typeOfOffer : placement.typeOfOffer || ""
      ).trim();

      const previousHasStatsContext =
        Boolean(previousCompanyId) &&
        Number.isInteger(Number(previousPlacementYear)) &&
        PPO_BRANCH_CODES.has(previousBranchCode) &&
        Boolean(previousTypeOfOffer);
      const nextHasStatsContext =
        Boolean(nextCompanyId) &&
        Number.isInteger(Number(nextPlacementYear)) &&
        PPO_BRANCH_CODES.has(nextBranchCode) &&
        Boolean(nextTypeOfOffer);

      if (previousHasStatsContext || nextHasStatsContext) {
        const oldChanged =
          previousCompanyId !== nextCompanyId ||
          Number(previousPlacementYear) !== Number(nextPlacementYear) ||
          previousBranchCode !== nextBranchCode ||
          normalizeOfferType(previousTypeOfOffer) !== normalizeOfferType(nextTypeOfOffer);

        if (oldChanged) {
          if (previousHasStatsContext) {
            const oldResolved = await resolveApprovedVisitForSpcPlacementOffer(
              previousCompanyId,
              Number(previousPlacementYear),
              previousTypeOfOffer,
              null
            );
            if (oldResolved.ok) {
              const decOld = isPpoOfferType(previousTypeOfOffer)
                ? await incrementPpoBranchGotInForAnchoredVisit(
                    previousCompanyId,
                    Number(previousPlacementYear),
                    previousBranchCode,
                    -1,
                    0,
                    { resolvedVisit: oldResolved.visit }
                  )
                : await incrementPlacementGotInBranchForAnchoredVisit(
                    previousCompanyId,
                    Number(previousPlacementYear),
                    previousBranchCode,
                    -1,
                    null,
                    { resolvedVisit: oldResolved.visit }
                  );
              if (!decOld.ok) {
                console.warn("SPC placement edit: old company got-in decrement failed:", decOld.reason);
              }
            } else {
              console.warn("SPC placement edit: old company visit resolution failed:", oldResolved.message);
            }
          }

          if (nextHasStatsContext) {
            const nextResolved = await resolveApprovedVisitForSpcPlacementOffer(
              nextCompanyId,
              Number(nextPlacementYear),
              nextTypeOfOffer,
              null
            );
            if (nextResolved.ok) {
              const incNext = isPpoOfferType(nextTypeOfOffer)
                ? await incrementPpoBranchGotInForAnchoredVisit(
                    nextCompanyId,
                    Number(nextPlacementYear),
                    nextBranchCode,
                    1,
                    0,
                    { resolvedVisit: nextResolved.visit }
                  )
                : await incrementPlacementGotInBranchForAnchoredVisit(
                    nextCompanyId,
                    Number(nextPlacementYear),
                    nextBranchCode,
                    1,
                    null,
                    { resolvedVisit: nextResolved.visit }
                  );
              if (!incNext.ok) {
                console.warn("SPC placement edit: new company got-in increment failed:", incNext.reason);
              }
            } else {
              console.warn("SPC placement edit: new company visit resolution failed:", nextResolved.message);
            }
          }
        }
      }

      const previousEmail = String(previousStudent?.email || "").trim().toLowerCase();
      if (previousEmail) await invalidateStudentProfileCacheByEmail(previousEmail).catch(() => {});
      if (nextStudentEmail && nextStudentEmail !== previousEmail) {
        await invalidateStudentProfileCacheByEmail(nextStudentEmail).catch(() => {});
      }

      await Promise.all([
        invalidateSpcMyRecordsCacheByEmail(email).catch(() => {}),
        invalidatePlacementStatsAfterWrite(),
      ]);

      return res.json({ message: "Placement record updated successfully" });
    } catch (error) {
      console.error("❌ Error updating SPC placement record:", error.message);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * Company-card contribution submissions + placement/conversion rows this SPC filed (`createdBy`).
 * Read-through Redis cache; invalidated on SPC add/edit/delete (see spcMyRecordsCache.js).
 */
router.get("/spc/my-submissions", authJWT, requireSPC, async (req, res) => {
  try {
    const email = String(req.user?.email || "").trim().toLowerCase();
    const userId = String(req.user?._id || req.user?.id || "").trim();

    const cached = await getCachedSpcMyRecords(email);
    if (cached) {
      return res.json(cached);
    }

    const payload = await loadSpcMyRecordsFromDb(email, userId);
    await setCachedSpcMyRecords(email, payload);
    return res.json(payload);
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
      const ppoConversionType = typeOfOffer;
      const stipendInput = String(stipend ?? "").trim();
      const conversionStipendVal =
        conversionType === "fte_internship" ? stipendInput : "";
      const roleTrim = String(roleRaw ?? "").trim();
      const ctcTrim = String(ctc ?? "").trim();
      const baseTrim = String(base ?? "").trim();
      const branchLower = String(branchCode || "").trim().toLowerCase();

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

      const resolvedPlacement = await findPlacementRowForSpcConversionDetails(
        student._id,
        cid,
        placementYear,
        companyPlaced
      );
      let existing = resolvedPlacement.doc;
      let matchKind = resolvedPlacement.matchKind;

      if (existing && matchKind !== "keyed") {
        const keyedDup = await PlacementData.findOne({
          studentId: student._id,
          companyId: cid,
          placementYear,
        })
          .sort({ updatedAt: -1 })
          .lean();
        if (keyedDup && String(keyedDup._id) !== String(existing._id)) {
          existing = keyedDup;
          matchKind = "keyed";
        }
      }

      if (!existing) {
        return res.status(400).json({
          message:
            "Conversion can be submitted only after an existing Internship(PPO) record is present for this student and company/year.",
        });
      }

      const firstTimeConversionForThisRecord = !String(existing.ppoConversionType || "").trim();
      const shouldIncrementConvertedOnly = Boolean(firstTimeConversionForThisRecord);
      const stipendVal =
        conversionType === "fte_internship"
          ? stipendInput
          : String(existing.stipend ?? "").trim();
      const visitSyncFields = {
        conversionType,
        role: roleTrim,
        ctc: ctcTrim,
        base: baseTrim,
        stipend: stipendVal,
      };

      await PlacementData.findByIdAndUpdate(existing._id, {
        companyPlaced,
        companyId: cid,
        placementYear,
        ppoConversionType,
        "6-months-internship-stipend": conversionStipendVal,
        base: baseTrim,
        ctc: ctcTrim,
        role: roleTrim,
        branchCode: branchLower,
        createdBy,
      });

      let incVisitOk = true;
      if (shouldIncrementConvertedOnly) {
        const inc = await incrementPpoBranchGotInForAnchoredVisit(
          companyId,
          placementYear,
          branchCode,
          0,
          1,
          {
            placementListContext: placementCtxForVisit,
            resolvedVisit,
            spcConversion: visitSyncFields,
          }
        );
        incVisitOk = inc.ok;
        if (!incVisitOk) {
          console.warn(
            "SPC conversion-details: PPO converted increment failed:",
            inc.reason
          );
        }
      } else {
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
      }

      if (!incVisitOk) {
        return res.status(500).json({
          message: "Failed to update company visit PPO conversion stats",
        });
      }

      await invalidateStudentProfileCacheByEmail(email).catch(() => {});
      await Promise.all([
        invalidateSpcMyRecordsCacheByEmail(String(req.user?.email || "")).catch(() => {}),
        invalidatePlacementStatsAfterWrite(),
      ]);

      return res.json({
        message: shouldIncrementConvertedOnly ? "Conversion details saved" : "Conversion details updated",
        studentId: student._id,
        placementId: existing._id,
        ppoBranchConvertedIncremented: shouldIncrementConvertedOnly,
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

    if (!studentByEmail) {
      return res.status(400).json({
        message: "Student email does not exist. Add the student record before submitting placement.",
      });
    }

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
    let shouldSave = false;
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
      await Promise.all([
        invalidateSpcMyRecordsCacheByEmail(String(req.user?.email || "")).catch(() => {}),
        invalidatePlacementStatsAfterWrite(),
      ]);

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
    await Promise.all([
      invalidateSpcMyRecordsCacheByEmail(String(req.user?.email || "")).catch(() => {}),
      invalidatePlacementStatsAfterWrite(),
    ]);

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

