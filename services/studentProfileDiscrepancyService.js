import User1 from "../models/User1.js";
import Student from "../models/Student.js";
import { ADMIN_EMAILS } from "../config/constants.js";
import { createNotification } from "./notificationService.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * @param {string} userEmail
 */
export async function getProfileDiscrepancyReportStatus(userEmail) {
  const email = normalizeEmail(userEmail);
  if (!email) return { hasReported: false };

  const student = await Student.findOne({ email })
    .select("profileDiscrepancyReported")
    .lean();
  if (!student) return { hasReported: false };

  return { hasReported: student.profileDiscrepancyReported === true };
}

/**
 * @param {{ email: string, username?: string }} user
 */
async function notifyAdminsOfProfileDiscrepancy(params) {
  const admins = await User1.find({ email: { $in: ADMIN_EMAILS } })
    .select("_id email")
    .lean();

  if (!admins.length) return;

  const studentLabel =
    (params.studentName && String(params.studentName).trim()) ||
    (params.requesterName && String(params.requesterName).trim()) ||
    params.requesterEmail ||
    "A student";
  const usnPart = params.studentUsn ? ` (${params.studentUsn})` : "";
  const title = "Profile discrepancies reported";
  const body = `${studentLabel}${usnPart} flagged incorrect information on their placement profile.`;
  const requesterKey = normalizeEmail(params.requesterEmail).replace(/[^a-z0-9]/g, "_");

  await Promise.all(
    admins.map((admin) =>
      createNotification({
        userId: admin._id,
        type: "PROFILE_DISCREPANCY_REPORT",
        title,
        body,
        payload: {
          requesterEmail: params.requesterEmail,
          requesterName: params.requesterName,
          studentName: params.studentName,
          studentUsn: params.studentUsn,
          studentId: params.studentId,
        },
        priority: "high",
        eventId: `PROFILE_DISCREPANCY_${requesterKey}_${String(admin._id)}`,
      })
    )
  );
}

/**
 * One discrepancy report per student roster row (by login email).
 * @param {{ email: string, username?: string }} user
 */
export async function submitProfileDiscrepancyReport(user) {
  const email = normalizeEmail(user?.email);
  if (!email) {
    return { ok: false, reason: "invalid_input", hasReported: false };
  }

  const student = await Student.findOne({ email })
    .select("name usn profileDiscrepancyReported")
    .lean();
  if (!student) {
    return { ok: false, reason: "not_found", hasReported: false };
  }

  if (student.profileDiscrepancyReported === true) {
    return { ok: false, reason: "already_reported", hasReported: true };
  }

  const res = await Student.updateOne(
    {
      email,
      profileDiscrepancyReported: { $ne: true },
    },
    { $set: { profileDiscrepancyReported: true } }
  );

  if (res.modifiedCount === 0) {
    return { ok: false, reason: "already_reported", hasReported: true };
  }

  await notifyAdminsOfProfileDiscrepancy({
    requesterEmail: email,
    requesterName: user?.username,
    studentName: student.name,
    studentUsn: student.usn,
    studentId: String(student._id),
  });

  return { ok: true, hasReported: true };
}
