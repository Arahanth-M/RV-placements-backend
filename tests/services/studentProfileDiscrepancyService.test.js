import mongoose from "mongoose";
import { jest } from "@jest/globals";
import Student from "../../models/Student.js";
import User1 from "../../models/User1.js";
import { ADMIN_EMAILS } from "../../config/constants.js";

const createNotification = jest.fn(async () => ({
  _id: new mongoose.Types.ObjectId(),
  type: "PROFILE_DISCREPANCY_REPORT",
}));

jest.unstable_mockModule("../../services/notificationService.js", () => ({
  createNotification,
}));

const { getProfileDiscrepancyReportStatus, submitProfileDiscrepancyReport } =
  await import("../../services/studentProfileDiscrepancyService.js");

describe("studentProfileDiscrepancyService", () => {
  const studentEmail = "discrepancy.student@test.rvce.edu.in";
  const adminEmail = ADMIN_EMAILS[0];
  let studentId;

  beforeEach(async () => {
    createNotification.mockClear();

    const student = await Student.create({
      name: "Discrepancy Test",
      email: studentEmail,
      usn: "1RV22CS099",
    });
    studentId = student._id;

    await User1.findOneAndUpdate(
      { email: adminEmail },
      { email: adminEmail, username: "Test Admin" },
      { upsert: true, new: true }
    );
  });

  afterEach(async () => {
    await Student.deleteMany({ _id: studentId });
  });

  it("returns hasReported false before a report", async () => {
    const status = await getProfileDiscrepancyReportStatus(studentEmail);
    expect(status.hasReported).toBe(false);
  });

  it("allows one discrepancy report per student and notifies admins", async () => {
    const first = await submitProfileDiscrepancyReport({
      email: studentEmail,
      username: "Discrepancy Test",
    });
    expect(first.ok).toBe(true);
    expect(first.hasReported).toBe(true);

    const status = await getProfileDiscrepancyReportStatus(studentEmail);
    expect(status.hasReported).toBe(true);

    expect(createNotification).toHaveBeenCalled();
    const notifyCall = createNotification.mock.calls[0]?.[0];
    expect(notifyCall?.type).toBe("PROFILE_DISCREPANCY_REPORT");
    expect(notifyCall?.body).toMatch(/Discrepancy Test/);
    expect(notifyCall?.payload?.studentUsn).toBe("1RV22CS099");

    const second = await submitProfileDiscrepancyReport({
      email: studentEmail,
      username: "Discrepancy Test",
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("already_reported");
  });
});
