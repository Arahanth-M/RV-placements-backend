import mongoose from "mongoose";
import CompanyStatic from "../models/CompanyStatic.js";
import { invalidateCompanyDetailCache } from "./companyDetailCache.js";

function toObjectId(id) {
  if (id == null) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {string} userEmail
 */
export async function getCompanyDetailRequestStatus(companyId, userEmail) {
  const cid = toObjectId(companyId);
  const email = normalizeEmail(userEmail);
  if (!cid || !email) {
    return { hasRequested: false };
  }

  const doc = await CompanyStatic.findById(cid).select("detailRequestUsers").lean();
  if (!doc) return { hasRequested: false };

  const users = Array.isArray(doc.detailRequestUsers) ? doc.detailRequestUsers : [];
  return { hasRequested: users.some((entry) => normalizeEmail(entry) === email) };
}

/**
 * One request per student email per company. Surfaced on the admin dashboard (not notifications).
 * @param {string|import("mongoose").Types.ObjectId} companyId
 * @param {{ email: string, username?: string, userId?: string }} user
 * @param {{ placementYear?: number|null }} [options]
 */
export async function submitCompanyDetailRequest(companyId, user, options = {}) {
  const cid = toObjectId(companyId);
  const email = normalizeEmail(user?.email);
  if (!cid || !email) {
    return { ok: false, reason: "invalid_input", hasRequested: false };
  }

  const existing = await CompanyStatic.findById(cid).select("name detailRequestUsers").lean();
  if (!existing) {
    return { ok: false, reason: "not_found", hasRequested: false };
  }

  const users = Array.isArray(existing.detailRequestUsers) ? existing.detailRequestUsers : [];
  if (users.some((entry) => normalizeEmail(entry) === email)) {
    return { ok: false, reason: "already_requested", hasRequested: true };
  }

  const res = await CompanyStatic.updateOne(
    {
      _id: cid,
      $expr: {
        $not: {
          $in: [email, { $ifNull: ["$detailRequestUsers", []] }],
        },
      },
    },
    { $push: { detailRequestUsers: email } }
  );

  if (res.modifiedCount === 0) {
    return { ok: false, reason: "already_requested", hasRequested: true };
  }

  await invalidateCompanyDetailCache(cid);

  return { ok: true, hasRequested: true };
}
