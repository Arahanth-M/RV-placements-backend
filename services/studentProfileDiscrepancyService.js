import Student from "../models/Student.js";

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
 * One discrepancy report per student roster row (by login email).
 * Surfaced on the admin dashboard (not notifications).
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

  return { ok: true, hasReported: true };
}
