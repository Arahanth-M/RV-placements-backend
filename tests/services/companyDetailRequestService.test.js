import mongoose from "mongoose";
import { jest } from "@jest/globals";
import CompanyStatic from "../../models/CompanyStatic.js";
import User1 from "../../models/User1.js";
import { ADMIN_EMAILS } from "../../config/constants.js";

const createNotification = jest.fn(async () => ({
  _id: new mongoose.Types.ObjectId(),
  type: "COMPANY_DETAIL_REQUEST",
}));

jest.unstable_mockModule("../../services/notificationService.js", () => ({
  createNotification,
}));

const { getCompanyDetailRequestStatus, submitCompanyDetailRequest } = await import(
  "../../services/companyDetailRequestService.js"
);

describe("companyDetailRequestService", () => {
  let companyId;
  const studentEmail = "student.request@test.rvce.edu.in";
  const adminEmail = ADMIN_EMAILS[0];

  beforeEach(async () => {
    createNotification.mockClear();

    const company = await CompanyStatic.create({
      name: "Request Test Co",
      nameKey: `request-test-co-${Date.now()}`,
    });
    companyId = company._id;

    await User1.findOneAndUpdate(
      { email: adminEmail },
      { email: adminEmail, username: "Test Admin" },
      { upsert: true, new: true }
    );
  });

  afterEach(async () => {
    await CompanyStatic.deleteMany({ _id: companyId });
  });

  it("returns hasRequested false before a request", async () => {
    const status = await getCompanyDetailRequestStatus(companyId, studentEmail);
    expect(status.hasRequested).toBe(false);
  });

  it("allows one request per student and notifies admins", async () => {
    const first = await submitCompanyDetailRequest(
      companyId,
      { email: studentEmail, username: "Test Student" },
      { placementYear: 2026 }
    );
    expect(first.ok).toBe(true);
    expect(first.hasRequested).toBe(true);

    const status = await getCompanyDetailRequestStatus(companyId, studentEmail);
    expect(status.hasRequested).toBe(true);

    expect(createNotification).toHaveBeenCalled();
    const notifyCall = createNotification.mock.calls[0]?.[0];
    expect(notifyCall?.type).toBe("COMPANY_DETAIL_REQUEST");
    expect(notifyCall?.payload?.companyId).toBe(String(companyId));
    expect(notifyCall?.body).toMatch(/Test Student/);

    const second = await submitCompanyDetailRequest(companyId, {
      email: studentEmail,
      username: "Test Student",
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("already_requested");
  });
});
