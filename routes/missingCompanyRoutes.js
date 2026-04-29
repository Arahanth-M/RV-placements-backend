import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import authJWT from "../middleware/authJWT.js";
import checkBetaAccess from "../middleware/checkBetaAccess.js";
import MissingCompany from "../models/MissingCompany.js";
import User from "../models/User.js";
import {
  config,
  STUDENT_PROFILE_COLLECTION,
  STUDENT_EMAIL_FIELD,
} from "../config/constants.js";
import { buildJwtPayloadFromUser } from "../utils/jwtUserClaims.js";

const router = express.Router();

const STUDENT_COLLECTION = STUDENT_PROFILE_COLLECTION;
const COMPANY_FIELDS = [
  "Summer internship Company name",
  "FTE Company name",
  "Only internship Company name",
  "FTE and internship Company name",
  "6 months Internship Company name",
  "Company name",
  "Company_Name",
  "Name of Company",
  "company1",
  "company2",
  "company3",
  "company4",
  "company5",
  "Company",
  "company",
];

function isPlacementCompanyField(fieldName) {
  const k = String(fieldName || "");
  return (
    /company\s*name|name\s*of\s*company/i.test(k) ||
    /company[_\s]+name/i.test(k)
  );
}

function normalizeText(raw) {
  if (raw == null) return "";
  return String(raw).trim();
}

function normalizeCompanyName(raw) {
  return normalizeText(raw).toLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractPlacementCompanyNames(studentRecord) {
  const record = studentRecord && typeof studentRecord === "object" ? studentRecord : {};
  const companyNameSet = new Map();
  const dynamicCompanyFields = Object.keys(record).filter((key) => isPlacementCompanyField(key));
  const candidateFields = [...new Set([...COMPANY_FIELDS, ...dynamicCompanyFields])];

  for (const fieldName of candidateFields) {
    const companyName = normalizeText(record[fieldName]);
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

    const db = mongoose.connection.db;
    const usersCollection = db.collection(STUDENT_COLLECTION);
    const dbUserId = req.user?._id ?? req.user?.id;
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

    const dbUser = await User.findById(dbUserId)
      .select("_id email isBetaListed role userId username picture fillForm points isPremium membershipType createdAt hasSubmittedMissingCompanyRequest")
      .lean();

    if (!dbUser?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (dbUser.isBetaListed !== true) {
      return res.status(403).json({
        success: false,
        message: "Access restricted to beta users",
      });
    }

    if (dbUser.hasSubmittedMissingCompanyRequest === true) {
      return res.status(403).json({
        message: "You have already submitted a missing company request",
      });
    }

    const escapedEmail = escapeRegex(String(dbUser.email).trim().toLowerCase());
    let studentRecord = await usersCollection.findOne({
      [STUDENT_EMAIL_FIELD]: dbUser.email,
    });

    if (!studentRecord) {
      studentRecord = await usersCollection.findOne({
        [STUDENT_EMAIL_FIELD]: {
          $regex: new RegExp(`^\\s*${escapedEmail}\\s*$`, "i"),
        },
      });
    }

    const placementCompanies = extractPlacementCompanyNames(studentRecord);
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

    const updatedUser = await User.findByIdAndUpdate(
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
