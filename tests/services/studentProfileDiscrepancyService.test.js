import Student from "../../models/Student.js";

const { getProfileDiscrepancyReportStatus, submitProfileDiscrepancyReport } =
  await import("../../services/studentProfileDiscrepancyService.js");

describe("studentProfileDiscrepancyService", () => {
  const studentEmail = "discrepancy.student@test.rvce.edu.in";
  let studentId;

  beforeEach(async () => {
    const student = await Student.create({
      name: "Discrepancy Test",
      email: studentEmail,
      usn: "1RV22CS099",
    });
    studentId = student._id;
  });

  afterEach(async () => {
    await Student.deleteMany({ _id: studentId });
  });

  it("returns hasReported false before a report", async () => {
    const status = await getProfileDiscrepancyReportStatus(studentEmail);
    expect(status.hasReported).toBe(false);
  });

  it("allows one discrepancy report per student without creating notifications", async () => {
    const first = await submitProfileDiscrepancyReport({
      email: studentEmail,
      username: "Discrepancy Test",
    });
    expect(first.ok).toBe(true);
    expect(first.hasReported).toBe(true);

    const status = await getProfileDiscrepancyReportStatus(studentEmail);
    expect(status.hasReported).toBe(true);

    const doc = await Student.findById(studentId).select("profileDiscrepancyReported").lean();
    expect(doc?.profileDiscrepancyReported).toBe(true);

    const second = await submitProfileDiscrepancyReport({
      email: studentEmail,
      username: "Discrepancy Test",
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("already_reported");
  });
});
