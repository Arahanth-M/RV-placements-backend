import { jest } from "@jest/globals";

describe("admin email allowlist", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("parses ADMIN_EMAILS comma-separated list", async () => {
    process.env.ADMIN_EMAILS =
      "first@rvce.edu.in, second@rvce.edu.in,first@rvce.edu.in";

    const { ADMIN_EMAILS, isAdminEmail } = await import("../../config/constants.js");
    expect(ADMIN_EMAILS).toEqual(["first@rvce.edu.in", "second@rvce.edu.in"]);
    expect(isAdminEmail("first@rvce.edu.in")).toBe(true);
    expect(isAdminEmail("SECOND@rvce.edu.in")).toBe(true);
    expect(isAdminEmail("other@rvce.edu.in")).toBe(false);
  });

  it("falls back to ADMIN_EMAIL when ADMIN_EMAILS is unset", async () => {
    process.env.ADMIN_EMAIL = "solo@rvce.edu.in";

    const { ADMIN_EMAILS, ADMIN_EMAIL, isAdminEmail } = await import(
      "../../config/constants.js"
    );
    expect(ADMIN_EMAILS).toEqual(["solo@rvce.edu.in"]);
    expect(ADMIN_EMAIL).toBe("solo@rvce.edu.in");
    expect(isAdminEmail("solo@rvce.edu.in")).toBe(true);
  });

  it("rejects empty or missing email", async () => {
    process.env.ADMIN_EMAILS = "admin@rvce.edu.in";

    const { isAdminEmail } = await import("../../config/constants.js");
    expect(isAdminEmail("")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });
});
