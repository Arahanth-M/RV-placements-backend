import CompanyStatic from "../models/CompanyStatic.js";
import Student from "../models/Student.js";
import { listPendingInterviewLimitRequestsForAdmin } from "./interviewLimitRequestService.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Admin dashboard: company detail requests + profile discrepancy reports.
 */
export async function listAdminStudentRequests() {
  const [companyRows, discrepancyRows, interviewLimitRequests] = await Promise.all([
    CompanyStatic.find({
      detailRequestUsers: { $exists: true, $ne: [] },
    })
      .select("name detailRequestUsers updatedAt")
      .sort({ updatedAt: -1 })
      .lean(),
    Student.find({ profileDiscrepancyReported: true })
      .select("name usn email updatedAt")
      .sort({ updatedAt: -1 })
      .lean(),
    listPendingInterviewLimitRequestsForAdmin(),
  ]);

  const requesterEmails = new Set();
  for (const row of companyRows) {
    for (const email of row.detailRequestUsers || []) {
      const normalized = normalizeEmail(email);
      if (normalized) requesterEmails.add(normalized);
    }
  }

  const requesterStudents =
    requesterEmails.size > 0
      ? await Student.find({ email: { $in: [...requesterEmails] } })
          .select("name usn email")
          .lean()
      : [];

  const studentByEmail = new Map(
    requesterStudents.map((student) => [normalizeEmail(student.email), student])
  );

  const companyDetailRequests = companyRows.map((row) => {
    const requesters = (row.detailRequestUsers || []).map((email) => {
      const normalized = normalizeEmail(email);
      const student = studentByEmail.get(normalized);
      return {
        email: normalized,
        name: student?.name || null,
        usn: student?.usn || null,
      };
    });

    return {
      companyId: String(row._id),
      companyName: row.name || "Company",
      requestCount: requesters.length,
      requesters,
      updatedAt: row.updatedAt,
    };
  });

  const profileDiscrepancies = discrepancyRows.map((row) => ({
    studentId: String(row._id),
    name: row.name,
    usn: row.usn,
    email: row.email,
    reportedAt: row.updatedAt,
  }));

  return {
    companyDetailRequests,
    profileDiscrepancies,
    interviewLimitRequests,
    totals: {
      companyDetailRequestCount: companyDetailRequests.reduce(
        (sum, row) => sum + row.requestCount,
        0
      ),
      companiesWithRequests: companyDetailRequests.length,
      profileDiscrepancyCount: profileDiscrepancies.length,
      interviewLimitRequestCount: interviewLimitRequests.length,
    },
  };
}
