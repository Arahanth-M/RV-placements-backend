import express from "express";
import jwt from "jsonwebtoken";
import authJWT from "../middleware/authJWT.js";
import checkBetaAccess from "../middleware/checkBetaAccess.js";
import MissingCompany from "../models/MissingCompany.js";
import PlacementData from "../models/PlacementData.js";
import Student from "../models/Student.js";
import { config } from "../config/constants.js";
import { buildJwtPayloadFromUser } from "../utils/jwtUserClaims.js";
import { getAuthUserModel } from "../utils/authUserModel.js";

const router = express.Router();

function normalizeText(raw) {
  if (raw == null) return "";
  return String(raw).trim();
}

function normalizeCompanyName(raw) {
  return normalizeText(raw).toLowerCase();
}

function extractPlacementCompanyNames(placements) {
  const companyNameSet = new Map();

  for (const placement of Array.isArray(placements) ? placements : []) {
    const companyName = normalizeText(placement?.companyPlaced);
    if (!companyName) continue;

    const normalizedName = normalizeCompanyName(companyName);
    if (!companyNameSet.has(normalizedName)) {
      companyNameSet.set(normalizedName, companyName);
    }
  }

  return Array.from(companyNameSet.values());
}

function setUpdatedTokenCookie(res, user, options = {}) {
  if (!config.JWT_SECRET) return;
  const payload = buildJwtPayloadFromUser(user, options);
  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

router.post("/", authJWT, checkBetaAccess, async (req, res) => {
  try {
    const category = normalizeText(req.body?.category);
    if (!category) {
      return res.status(400).json({ error: "category is required" });
    }

    if (!req.user?.email || !req.user?._id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const dbUserId = req.user?._id ?? req.user?.id;
    const AuthUserModel = getAuthUserModel(req);
    const companyNamesInput = Array.isArray(req.body?.companyNames)
      ? req.body.companyNames
      : req.body?.companyName != null
        ? [req.body.companyName]
        : [];
    const normalizedRequestMap = new Map();

    for (const rawCompanyName of companyNamesInput) {
      const trimmedCompanyName = normalizeText(rawCompanyName);
      if (!trimmedCompanyName) continue;
      const normalized = normalizeCompanyName(trimmedCompanyName);
      if (!normalizedRequestMap.has(normalized)) {
        normalizedRequestMap.set(normalized, trimmedCompanyName);
      }
    }

    const requestedCompanies = Array.from(normalizedRequestMap.values());
    const requestedNormalizedNames = Array.from(normalizedRequestMap.keys());

    if (requestedCompanies.length === 0) {
      return res.status(400).json({ error: "companyName is required" });
    }

    const dbUser = await AuthUserModel.findById(dbUserId)
      .select("_id email role username picture profilePicture points createdAt hasSubmittedMissingCompanyRequest")
      .lean();

    if (!dbUser?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (dbUser.hasSubmittedMissingCompanyRequest === true) {
      return res.status(403).json({
        message: "You have already submitted a missing company request",
      });
    }

    const studentRecord = await Student.findOne({
      email: String(dbUser.email).trim().toLowerCase(),
    })
      .select("_id")
      .lean();

    if (!studentRecord?._id) {
      return res.status(404).json({ error: "Student record not found" });
    }

    const placements = await PlacementData.find({ studentId: studentRecord._id })
      .select("companyPlaced")
      .lean();
    const placementCompanies = extractPlacementCompanyNames(placements);
    const allowedCompanySet = new Set(
      placementCompanies.map((placementCompany) => normalizeCompanyName(placementCompany))
    );

    const hasInvalidCompany = requestedNormalizedNames.some(
      (normalizedName) => !allowedCompanySet.has(normalizedName)
    );

    if (hasInvalidCompany) {
      return res.status(403).json({ message: "Invalid company" });
    }

    const savedRequests = [];
    for (const companyName of requestedCompanies) {
      const normalizedName = normalizeCompanyName(companyName);
      const missingCompany = await MissingCompany.findOneAndUpdate(
        { normalizedName },
        {
          $setOnInsert: {
            name: companyName,
            normalizedName,
            status: "PENDING",
          },
          $inc: { requestCount: 1 },
          $addToSet: {
            requestedBy: dbUser._id,
            categories: category,
          },
        },
        {
          upsert: true,
          new: true,
        },
      );
      savedRequests.push(missingCompany);
    }

    const updatedUser = await AuthUserModel.findByIdAndUpdate(
      dbUser._id,
      { $set: { hasSubmittedMissingCompanyRequest: true } },
      { new: true }
    );

    if (updatedUser) {
      setUpdatedTokenCookie(res, updatedUser, {
        isAdminSession: req.user?.isAdminSession === true,
      });
    }

    return res.status(200).json({
      message: "Missing company request submitted successfully",
      missingCompany: savedRequests[0] || null,
      missingCompanies: savedRequests,
      user: updatedUser
        ? {
            ...buildJwtPayloadFromUser(updatedUser, {
              isAdminSession: req.user?.isAdminSession === true,
            }),
          }
        : null,
    });
  } catch (error) {
    console.error("❌ Error creating missing company request:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
