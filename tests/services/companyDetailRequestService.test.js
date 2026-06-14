import mongoose from "mongoose";
import CompanyStatic from "../../models/CompanyStatic.js";

const { getCompanyDetailRequestStatus, submitCompanyDetailRequest } = await import(
  "../../services/companyDetailRequestService.js"
);

describe("companyDetailRequestService", () => {
  let companyId;
  const studentEmail = "student.request@test.rvce.edu.in";

  beforeEach(async () => {
    const company = await CompanyStatic.create({
      name: "Request Test Co",
      nameKey: `request-test-co-${Date.now()}`,
    });
    companyId = company._id;
  });

  afterEach(async () => {
    await CompanyStatic.deleteMany({ _id: companyId });
  });

  it("returns hasRequested false before a request", async () => {
    const status = await getCompanyDetailRequestStatus(companyId, studentEmail);
    expect(status.hasRequested).toBe(false);
  });

  it("allows one request per student without creating notifications", async () => {
    const first = await submitCompanyDetailRequest(
      companyId,
      { email: studentEmail, username: "Test Student" },
      { placementYear: 2026 }
    );
    expect(first.ok).toBe(true);
    expect(first.hasRequested).toBe(true);

    const status = await getCompanyDetailRequestStatus(companyId, studentEmail);
    expect(status.hasRequested).toBe(true);

    const doc = await CompanyStatic.findById(companyId).select("detailRequestUsers").lean();
    expect(doc?.detailRequestUsers).toContain(studentEmail);

    const second = await submitCompanyDetailRequest(companyId, {
      email: studentEmail,
      username: "Test Student",
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("already_requested");
  });
});
