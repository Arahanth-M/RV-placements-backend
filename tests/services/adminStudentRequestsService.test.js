import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import mongoose from "mongoose";
import CompanyStatic from "../../models/CompanyStatic.js";
import Student from "../../models/Student.js";
import { listAdminStudentRequests } from "../../services/adminStudentRequestsService.js";

describe("adminStudentRequestsService", () => {
  let companyId;
  let studentId;

  beforeEach(async () => {
    const company = await CompanyStatic.create({
      name: "Admin Request Co",
      nameKey: `admin-request-co-${Date.now()}`,
      detailRequestUsers: ["student.one@test.rvce.edu.in"],
    });
    companyId = company._id;

    const student = await Student.create({
      name: "Discrepancy Student",
      email: "discrepancy.student@test.rvce.edu.in",
      usn: "1RV22CS001",
      profileDiscrepancyReported: true,
    });
    studentId = student._id;
  });

  afterEach(async () => {
    await CompanyStatic.deleteMany({ _id: companyId });
    await Student.deleteMany({ _id: studentId });
  });

  it("lists company detail requests and profile discrepancies", async () => {
    const data = await listAdminStudentRequests();

    expect(data.totals.companiesWithRequests).toBeGreaterThanOrEqual(1);
    expect(data.totals.profileDiscrepancyCount).toBeGreaterThanOrEqual(1);

    const companyRow = data.companyDetailRequests.find(
      (row) => row.companyId === String(companyId)
    );
    expect(companyRow?.companyName).toBe("Admin Request Co");
    expect(companyRow?.requesters).toEqual([
      expect.objectContaining({ email: "student.one@test.rvce.edu.in" }),
    ]);

    const discrepancyRow = data.profileDiscrepancies.find(
      (row) => row.studentId === String(studentId)
    );
    expect(discrepancyRow).toEqual(
      expect.objectContaining({
        name: "Discrepancy Student",
        usn: "1RV22CS001",
        email: "discrepancy.student@test.rvce.edu.in",
      })
    );
  });
});
