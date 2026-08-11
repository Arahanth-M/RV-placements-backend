import CompanyStatic from "../models/CompanyStatic.js";
import Student from "../models/Student.js";
import {
  collegeIdFromEmail,
  normalizeCollegeId,
  withCollegeEmailScope,
} from "../utils/collegeScope.js";
import { listPendingInterviewLimitRequestsForAdmin } from "./interviewLimitRequestService.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Admin dashboard: company detail requests + profile discrepancy reports.
 * Requester / student rows are college-scoped (read-only filter).
 * @param {unknown} [collegeIdRaw]
 */
export async function listAdminStudentRequests(collegeIdRaw = null) {
  const collegeId = normalizeCollegeId(collegeIdRaw);

  const [companyRows, discrepancyRows, interviewLimitRequests] = await Promise.all([
    CompanyStatic.find({
      detailRequestUsers: { $exists: true, $ne: [] },
    })
      .select("name detailRequestUsers updatedAt")
      .sort({ updatedAt: -1 })
      .lean(),
    Student.find(
      withCollegeEmailScope({ profileDiscrepancyReported: true }, collegeId, "email")
    )
      .select("name usn email updatedAt")
      .sort({ updatedAt: -1 })
      .lean(),
    listPendingInterviewLimitRequestsForAdmin(collegeId),
  ]);

  const requesterEmails = new Set();
  for (const row of companyRows) {
    for (const email of row.detailRequestUsers || []) {
      const normalized = normalizeEmail(email);
      if (!normalized) continue;
      if (collegeIdFromEmail(normalized) !== collegeId) continue;
      requesterEmails.add(normalized);
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

  const companyDetailRequests = companyRows
    .map((row) => {
      const requesters = (row.detailRequestUsers || [])
        .map((email) => normalizeEmail(email))
        .filter((normalized) => normalized && collegeIdFromEmail(normalized) === collegeId)
        .map((normalized) => {
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
    })
    .filter((row) => row.requestCount > 0);

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
    collegeId,
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
