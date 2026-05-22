import express from "express";
import authJWT from "../middleware/authJWT.js";
import validateRequest from "../middleware/validateRequest.js";
import { companyCreateSchema } from "../validations/company.validation.js";
import { submissionInputSchema } from "../validations/submission.validation.js";
import dotenv from "dotenv";
import Submission from "../models/Submission.js";
import Student from "../models/Student.js";
import { getCompanyFocusTags } from "../utils/companyFocusTags.js";
import { attachPlacementCategoryToCompany } from "../utils/ctcCategory.js";
import { projectCompanyListResponse } from "../utils/companyListProjection.js";
import redis from "../utils/redis.js";
import { companyDetailRedisKey } from "../services/companyDetailCache.js";
import {
  addHelpfulVote,
  createCompanyWithVisit,
  getApprovedPlacementYearsForCompany,
  getCompanyDetailLegacyMergedById,
  getCompanyMergedForAdminById,
  incrementVisitViews,
  getCompanyCategoryPreviewLogos,
  listApprovedCompaniesLegacyMerged,
  mergeToLegacyShape,
  normalizeCompanyDetailYear,
} from "../services/companyService.js";
import {
  clusterKeyFromPlacementVisitClusterField,
  normalizePlacementClusterQuery,
} from "../utils/placementCluster.js";
import { getPlacementHubSettingsForApi } from "../services/placementHubSettingsService.js";
import mongoose from "mongoose";
import { getAuthUserModel } from "../utils/authUserModel.js";
dotenv.config();

/** Redis TTL for GET /api/companies/:id payload cache (keep short — placement rows change often) */
const COMPANY_DETAIL_REDIS_TTL_SECONDS = 3 * 60;

const companyRouter = express.Router();

companyRouter.post("/", authJWT, validateRequest(companyCreateSchema), async (req, res) => {
  try {
    // Legacy create path: single document — now `createCompanyWithVisit` → `companies` + `company_visits`
    // const newCompany = new Company({
    //   ...req.body,
    //   submittedBy: {
    //     name: req.user.username,
    //     email: req.user.email,
    //   },
    // });
    // await newCompany.save();
    // res.status(201).json(newCompany);

    const { company, visit } = await createCompanyWithVisit({
      ...req.body,
      submittedBy: {
        name: req.user.username,
        email: req.user.email,
      },
    });
    const merged = mergeToLegacyShape(company, visit);
    return res.status(201).json(merged);
  } catch (err) {
    console.error("Error creating company:", err);
    res.status(500).json({ message: "Server error" });
  }
});
companyRouter.get("/", async (req, res) => {
  try {
    const selectedYear = req.query?.year;
    const requestedCluster = normalizePlacementClusterQuery(req.query?.cluster);
    // New DB: `companies` + approved `company_visits` (year-aware when `?year=` is sent)
    const companies = await listApprovedCompaniesLegacyMerged(selectedYear);
    const scopedCompanies =
      requestedCluster == null
        ? companies
        : companies.filter(
            (c) =>
              clusterKeyFromPlacementVisitClusterField(c?.cluster) === requestedCluster
          );

    const list = scopedCompanies.map((c) => {
      const focusTags = getCompanyFocusTags(c);
      const { onlineQuestions, interviewQuestions, interviewProcess, Must_Do_Topics, ...rest } = c;
      const withCategory = attachPlacementCategoryToCompany({ ...rest, focusTags });
      return projectCompanyListResponse({
        ...withCategory,
        category: c.category,
        totalCtcRupees: c.totalCtcRupees,
        placementAnyYearPpoOnCampus: c.placementAnyYearPpoOnCampus,
        placementHasDreamTierVisit: c.placementHasDreamTierVisit,
        placementDreamTierForListingYear: c.placementDreamTierForListingYear,
        placementSummerInternshipForListingYear:
          c.placementSummerInternshipForListingYear,
        placementSummerStrictVisitForListingYear:
          c.placementSummerStrictVisitForListingYear,
        placementDreamDisplayType: c.placementDreamDisplayType,
        placementDreamDetailYear: c.placementDreamDetailYear,
        placementSummerDisplayType: c.placementSummerDisplayType,
        placementSummerDetailYear: c.placementSummerDetailYear,
      });
    });

    return res.json(list);
  } catch (e) {
    console.error("❌ Error fetching companies:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

/** Per-cluster Open dream minimum LPA (admin-configurable; public read). */
companyRouter.get("/placement-hub-settings", async (_req, res) => {
  try {
    const settings = await getPlacementHubSettingsForApi();
    return res.json(settings);
  } catch (e) {
    console.error("❌ Error fetching placement hub settings:", e?.message);
    return res.status(500).json({ error: "Server error" });
  }
});

/** Lightweight category-tile data (counts + 5 logo rows per bucket) — must stay above `GET /:id` */
companyRouter.get("/preview-logos", async (req, res) => {
  try {
    const selectedYear = req.query?.year;
    const cluster = normalizePlacementClusterQuery(req.query?.cluster);
    const payload = await getCompanyCategoryPreviewLogos(selectedYear, cluster);
    return res.json(payload);
  } catch (e) {
    console.error("❌ Error fetching preview logos:", e?.message);
    return res.status(500).json({ error: "Server error" });
  }
});

companyRouter.post("/helpful/status/batch", authJWT, async (req, res) => {
  try {
    if (!req.user || !req.user.email) {
      return res.status(401).json({ error: "You must be logged in to view helpful status" });
    }

    const rawCompanyIds = Array.isArray(req.body?.companyIds) ? req.body.companyIds : [];
    const uniqueIds = [...new Set(rawCompanyIds.map((id) => String(id || "").trim()).filter(Boolean))];

    if (uniqueIds.length === 0) {
      return res.json({ statuses: {} });
    }

    const objectIds = uniqueIds
      .map((id) => {
        try {
          return new mongoose.Types.ObjectId(id);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (objectIds.length === 0) {
      return res.json({ statuses: {} });
    }

    const companiesCol = mongoose.connection.db?.collection("companies");
    const rows =
      (await companiesCol
        ?.find({ _id: { $in: objectIds } })
        .project({ _id: 1, helpfulUsers: 1, helpfulCount: 1 })
        .toArray()) || [];

    const statuses = {};
    for (const row of rows) {
      const helpfulUsers = Array.isArray(row.helpfulUsers) ? row.helpfulUsers : [];
      statuses[String(row._id)] = {
        hasUpvoted: helpfulUsers.includes(req.user.email),
        helpfulCount: row.helpfulCount ?? 0,
      };
    }

    return res.json({ statuses });
  } catch (error) {
    console.error("❌ Error fetching batch helpful status:", error);
    return res.status(500).json({ error: "Error fetching helpful status" });
  }
});

companyRouter.get("/:id", authJWT, async (req, res) => {
  const id = req.params.id;
  const placementVisitYear = normalizeCompanyDetailYear(req.query?.year);
  const placementCompanyVisitIdRaw = String(req.query?.placementCompanyVisitId || "").trim();
  const useExactVisitHint = placementCompanyVisitIdRaw !== "";
  const placementClusterResolved = normalizePlacementClusterQuery(
    req.query?.placementCluster
  );
  // Exact visit-id detail fetch must bypass cache because cache key does not include visit-id.
  const key = useExactVisitHint
    ? null
    : companyDetailRedisKey(
        id,
        placementVisitYear,
        req.query?.placementContext,
        placementClusterResolved
      );

  try {
    const isAdminSession = req.user?.isAdminSession === true || req.user?.role === "admin";
    if (!isAdminSession) {
      const loginEmail = String(req.user?.email || "").trim().toLowerCase();
      if (!loginEmail) {
        return res.status(403).json({ error: "Stay connected, we will be back soon" });
      }
      const studentRecord = await Student.findOne({ email: loginEmail })
        .select("_id")
        .lean();
      if (!studentRecord) {
        return res.status(403).json({ error: "Stay connected, we will be back soon" });
      }
    }

    const AuthUserModel = getAuthUserModel(req);
    const touchUserActivity = () =>
      AuthUserModel.updateOne(
        { _id: req.user?._id },
        { $set: { lastLoginAt: new Date(), lastActiveAt: new Date() } }
      ).catch(() => {});

    let companyOid = null;
    try {
      companyOid = new mongoose.Types.ObjectId(id);
    } catch {
      companyOid = null;
    }

    let cached = null;
    if (key) {
      try {
        cached = await redis.get(key);
      } catch {
        // Redis down or error — continue to MongoDB without logging
      }
    }
    if (cached != null && cached !== "") {
      try {
        const parsed = JSON.parse(cached);
        const placementYearsAvailable = companyOid
          ? await getApprovedPlacementYearsForCompany(
              companyOid,
              placementClusterResolved
            )
          : [];
        await Promise.all([
          companyOid
            ? incrementVisitViews(companyOid, null, placementVisitYear).catch(() => {})
            : Promise.resolve(),
          touchUserActivity(),
        ]);
        console.log("HIT — company found in Redis and served from cache:", id, "y=", placementVisitYear);
        const withMeta = {
          ...parsed,
          placementVisitYear,
          placementYearsAvailable,
        };
        return res.json(
          attachPlacementCategoryToCompany(withMeta, {
            clusterKey: placementClusterResolved ?? parsed?.cluster,
            placementYear: placementVisitYear,
          })
        );
      } catch {
        // Bad cache payload — fall through to MongoDB
      }
    }

    console.log("MISS — company not in Redis; fetched from MongoDB:", id, "y=", placementVisitYear);

    const { merged: companyObj, visit: visitForViews } = await getCompanyDetailLegacyMergedById(
      id,
      placementVisitYear,
      req.query?.placementContext,
      useExactVisitHint ? placementCompanyVisitIdRaw : null,
      placementClusterResolved
    );

    if (!companyObj) {
      return res.status(404).json({ error: "Company not found" });
    }

    if (!companyOid) {
      return res.status(404).json({ error: "Company not found" });
    }

    const placementYearsAvailable = await getApprovedPlacementYearsForCompany(
      companyOid,
      placementClusterResolved
    );

    await Promise.all([
      incrementVisitViews(companyOid, visitForViews?._id ?? null, placementVisitYear).catch(() => {}),
      touchUserActivity(),
    ]);

    // Convert Map -> Object for each role (if any Map slipped through)
    if (Array.isArray(companyObj.roles)) {
      companyObj.roles = companyObj.roles.map((role) => {
        if (!role || typeof role !== "object") return role;
        const ctc = role.ctc;
        if (ctc instanceof Map) {
          return { ...role, ctc: Object.fromEntries(ctc) };
        }
        return { ...role };
      });
    }

    // Ensure OA tab always has arrays (detail view expects these)
    if (!Array.isArray(companyObj.onlineQuestions)) {
      companyObj.onlineQuestions = [];
    }
    if (!Array.isArray(companyObj.onlineQuestions_solution)) {
      companyObj.onlineQuestions_solution = [];
    }

    // Legacy support: if onlineQuestions_solution missing, fallback to old field names
    const legacySolutionsArrays = [
      companyObj.onlineQuestions_solution,
      companyObj.onlineQuestion_solution,
      companyObj.onlineQuestion_solutions,
    ].filter(Array.isArray);

    if (
      (!companyObj.onlineQuestions_solution || companyObj.onlineQuestions_solution.length === 0) &&
      legacySolutionsArrays.length > 0
    ) {
      // Use the first available legacy array
      companyObj.onlineQuestions_solution = legacySolutionsArrays.find(Array.isArray);
    }
    delete companyObj.onlineQuestion_solution;
    delete companyObj.onlineQuestion_solutions;

    const company = attachPlacementCategoryToCompany(
      {
        ...companyObj,
        placementVisitYear,
        placementYearsAvailable,
        ...(visitForViews?._id
          ? { placementCompanyVisitId: String(visitForViews._id) }
          : {}),
      },
      {
        clusterKey:
          placementClusterResolved ??
          clusterKeyFromPlacementVisitClusterField(companyObj?.cluster),
        placementYear: placementVisitYear,
      }
    );

    if (key) {
      try {
        const forCache = { ...company };
        delete forCache.placementYearsAvailable;
        delete forCache.placementVisitYear;
        await redis.set(key, JSON.stringify(forCache), {
          EX: COMPANY_DETAIL_REDIS_TTL_SECONDS,
        });
      } catch {
        // Ignore Redis write failures; response already built from MongoDB
      }
    }

    return res.json(company);
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ error: "Company not found" });
    }
    res.status(500).json({ error: "Internal Server Error" });
  }
});








// Increment helpful count for a company (one vote per user)
companyRouter.post("/:id/helpful", authJWT, async (req, res) => {
  try {
    if (!req.user || !req.user.email) {
      return res.status(401).json({ error: "You must be logged in to upvote" });
    }

    const userEmail = req.user.email;
    const { id: companyIdParam } = req.params;
    const companiesCol = mongoose.connection.db?.collection("companies");

    // Upvote: `addHelpfulVote` updates `companies` (static); response reads fresh row below.

    const { updateResult, alreadyVoted } = await addHelpfulVote(companyIdParam, userEmail);

    let companyRow;
    try {
      companyRow = await companiesCol?.findOne({
        _id: new mongoose.Types.ObjectId(companyIdParam),
      });
    } catch {
      return res.status(404).json({ error: "Company not found" });
    }
    if (!companyRow) {
      return res.status(404).json({ error: "Company not found" });
    }

    const helpfulCount = companyRow.helpfulCount ?? 0;

    if (updateResult.modifiedCount > 0) {
      return res.json({ helpfulCount, hasUpvoted: true });
    }
    if (alreadyVoted) {
      return res.status(400).json({
        error: "You have already upvoted this company",
        helpfulCount,
        hasUpvoted: true,
      });
    }
    return res.json({ helpfulCount, hasUpvoted: false });
  } catch (error) {
    console.error("❌ Error updating helpful count:", error);
    res.status(500).json({ error: "Error updating helpful count" });
  }
});

// Check if current user has upvoted a company
companyRouter.get("/:id/helpful/status", authJWT, async (req, res) => {
  try {
    if (!req.user || !req.user.email) {
      return res.json({ hasUpvoted: false });
    }

    const loaded = await getCompanyMergedForAdminById(req.params.id);
    if (!loaded?.staticRow || !loaded.merged) {
      return res.status(404).json({ error: "Company not found" });
    }

    const { merged } = loaded;
    const helpfulUsers = merged.helpfulUsers;
    const hasUpvoted =
      Array.isArray(helpfulUsers) && helpfulUsers.includes(req.user.email);

    res.json({
      hasUpvoted: hasUpvoted || false,
      helpfulCount: merged.helpfulCount || 0,
    });
  } catch (error) {
    console.error("❌ Error checking helpful status:", error);
    res.status(500).json({ error: "Error checking helpful status" });
  }
});

companyRouter.post("/", validateRequest(submissionInputSchema), async (req, res) => {
  try {
    const { companyId, type, content } = req.body;

    if (!companyId || !type || !content) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const newSubmission = new Submission({ companyId, type, content });
    await newSubmission.save();

    res.status(201).json({ message: "Submission received and pending approval." });
  } catch (error) {
    res.status(500).json({ error: "Error saving submission" });
  }
});


export default companyRouter;
