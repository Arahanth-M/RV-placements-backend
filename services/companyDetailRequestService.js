import mongoose from "mongoose";
import CompanyStatic from "../models/CompanyStatic.js";
import User1 from "../models/User1.js";
import { ADMIN_EMAILS } from "../config/constants.js";
import { invalidateCompanyDetailCache } from "./companyDetailCache.js";
import { createNotification } from "./notificationService.js";

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
 * Notify platform admins (users1 rows matching ADMIN_EMAILS).
 * @param {{ companyId: string, companyName: string, requesterEmail: string, requesterName?: string, placementYear?: number|null }} params
 */
async function notifyAdminsOfCompanyDetailRequest(params) {
  const admins = await User1.find({ email: { $in: ADMIN_EMAILS } })
    .select("_id email")
    .lean();

  if (!admins.length) return;

  const studentLabel =
    (params.requesterName && String(params.requesterName).trim()) ||
    params.requesterEmail ||
    "A student";
  const yearPart =
    params.placementYear != null && Number.isFinite(Number(params.placementYear))
      ? ` (${Number(params.placementYear)})`
      : "";
  const companyName = params.companyName || "a company";
  const title = `Details requested: ${companyName}`;
  const body = `${studentLabel} asked for more company details for ${companyName}${yearPart}.`;
  const requesterKey = normalizeEmail(params.requesterEmail).replace(/[^a-z0-9]/g, "_");

  await Promise.all(
    admins.map((admin) =>
      createNotification({
        userId: admin._id,
        type: "COMPANY_DETAIL_REQUEST",
        title,
        body,
        payload: {
          companyId: String(params.companyId),
          companyName,
          requesterEmail: params.requesterEmail,
          requesterName: params.requesterName,
          placementYear: params.placementYear ?? undefined,
        },
        priority: "high",
        eventId: `DETAIL_REQUEST_${String(params.companyId)}_${requesterKey}_${String(admin._id)}`,
      })
    )
  );
}

/**
 * One request per student email per company. Notifies admins on first successful request.
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

  await notifyAdminsOfCompanyDetailRequest({
    companyId: String(cid),
    companyName: existing.name || "Company",
    requesterEmail: email,
    requesterName: user?.username,
    placementYear: options.placementYear,
  });

  return { ok: true, hasRequested: true };
}
