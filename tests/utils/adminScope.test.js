import { describe, it, expect } from "@jest/globals";
import { isPlatformAdminUser } from "../../utils/adminScope.js";

describe("isPlatformAdminUser", () => {
  it("requires an admin session and platform scope", () => {
    expect(isPlatformAdminUser(null)).toBe(false);
    expect(
      isPlatformAdminUser({ isAdminSession: true, adminScope: "campus" })
    ).toBe(false);
    expect(
      isPlatformAdminUser({
        isAdminSession: true,
        adminScope: "platform",
        isSuperAdmin: true,
      })
    ).toBe(true);
    expect(
      isPlatformAdminUser({
        isAdminSession: false,
        isSuperAdmin: true,
        adminScope: "platform",
      })
    ).toBe(false);
  });
});
