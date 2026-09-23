import { jest } from "@jest/globals";

describe("admin email allowlist", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
    delete process.env.PLATFORM_OWNER_EMAILS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("parses ADMIN_EMAILS comma-separated list", async () => {
    process.env.ADMIN_EMAILS =
      "first@rvce.edu.in, second@rvce.edu.in,first@rvce.edu.in";
    process.env.PLATFORM_OWNER_EMAILS = "owner@example.com";

    const { ADMIN_EMAILS, isAdminEmail, isCampusAdminEmail } = await import(
      "../../config/constants.js"
    );
    expect(ADMIN_EMAILS).toEqual(["first@rvce.edu.in", "second@rvce.edu.in"]);
    expect(isCampusAdminEmail("first@rvce.edu.in")).toBe(true);
    expect(isAdminEmail("first@rvce.edu.in")).toBe(true);
    expect(isAdminEmail("SECOND@rvce.edu.in")).toBe(true);
    expect(isAdminEmail("other@rvce.edu.in")).toBe(false);
  });

  it("falls back to ADMIN_EMAIL when ADMIN_EMAILS is unset", async () => {
    process.env.ADMIN_EMAILS = "";
    process.env.ADMIN_EMAIL = "solo@rvce.edu.in";
    process.env.PLATFORM_OWNER_EMAILS = "owner@example.com";

    const { ADMIN_EMAILS, ADMIN_EMAIL, isAdminEmail } = await import(
      "../../config/constants.js"
    );
    expect(ADMIN_EMAILS).toEqual(["solo@rvce.edu.in"]);
    expect(ADMIN_EMAIL).toBe("solo@rvce.edu.in");
    expect(isAdminEmail("solo@rvce.edu.in")).toBe(true);
  });

  it("keeps platform owners distinct from campus admins", async () => {
    process.env.ADMIN_EMAILS = "campus@rvce.edu.in";
    process.env.PLATFORM_OWNER_EMAILS = "owner@gmail.com";

    const {
      isPlatformOwnerEmail,
      isCampusAdminEmail,
      isAdminEmail,
      adminIdentityFromEmail,
    } = await import("../../config/constants.js");

    expect(isPlatformOwnerEmail("owner@gmail.com")).toBe(true);
    expect(isCampusAdminEmail("owner@gmail.com")).toBe(false);
    expect(isCampusAdminEmail("campus@rvce.edu.in")).toBe(true);
    expect(isPlatformOwnerEmail("campus@rvce.edu.in")).toBe(false);
    expect(isAdminEmail("owner@gmail.com")).toBe(true);
    expect(adminIdentityFromEmail("owner@gmail.com")).toEqual({
      adminScope: "platform",
      isSuperAdmin: true,
    });
    expect(adminIdentityFromEmail("campus@rvce.edu.in")).toEqual({
      adminScope: "campus",
      isSuperAdmin: false,
    });
  });

  it("rejects empty or missing email", async () => {
    process.env.ADMIN_EMAILS = "admin@rvce.edu.in";
    process.env.PLATFORM_OWNER_EMAILS = "owner@example.com";

    const { isAdminEmail } = await import("../../config/constants.js");
    expect(isAdminEmail("")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });

  it("treats missing PLATFORM_OWNER_EMAILS as no platform owners", async () => {
    process.env.ADMIN_EMAILS = "campus@rvce.edu.in";
    process.env.PLATFORM_OWNER_EMAILS = "";

    const {
      PLATFORM_OWNER_EMAILS,
      isPlatformOwnerEmail,
      isCampusAdminEmail,
      adminIdentityFromEmail,
    } = await import("../../config/constants.js");

    expect(PLATFORM_OWNER_EMAILS).toEqual([]);
    expect(isPlatformOwnerEmail("campus@rvce.edu.in")).toBe(false);
    expect(isCampusAdminEmail("campus@rvce.edu.in")).toBe(true);
    expect(adminIdentityFromEmail("campus@rvce.edu.in")).toEqual({
      adminScope: "campus",
      isSuperAdmin: false,
    });
  });
});
