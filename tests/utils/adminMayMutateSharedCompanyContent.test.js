import { describe, it, expect } from "@jest/globals";
import { adminMayMutateSharedCompanyContent } from "../../utils/collegeScope.js";

describe("adminMayMutateSharedCompanyContent", () => {
  it("allows RVCE admins", () => {
    expect(
      adminMayMutateSharedCompanyContent({
        isAdminSession: true,
        email: "placement@rvce.edu.in",
        collegeId: "rvce",
      })
    ).toBe(true);
  });

  it("blocks RVITM admins", () => {
    expect(
      adminMayMutateSharedCompanyContent({
        isAdminSession: true,
        email: "placement.rvitm@rvei.edu.in",
        collegeId: "rvitm",
      })
    ).toBe(false);
  });

  it("blocks non-admins", () => {
    expect(
      adminMayMutateSharedCompanyContent({
        isAdminSession: false,
        role: "student",
        email: "someone@rvce.edu.in",
        collegeId: "rvce",
      })
    ).toBe(false);
  });
});
