import { describe, expect, it } from "@jest/globals";
import { isPlatformFresherRole } from "../../config/interviewCatalog.js";
import { matchPlatformFresherRole } from "../../services/prepPath/suggestGeneralMock.js";

describe("PrepPath /general fresher role catalog", () => {
  it("accepts every catalog role as a valid platform PrepPath role", () => {
    for (const role of [
      "Software Engineer (SDE)",
      "Backend Engineer",
      "VLSI/Hardware Engineer",
    ]) {
      expect(isPlatformFresherRole(role)).toBe(true);
      expect(matchPlatformFresherRole(role)).toBe(role);
    }
  });

  it("rejects free-text roles that are not in the catalog", () => {
    expect(isPlatformFresherRole("SDE Intern")).toBe(false);
    expect(matchPlatformFresherRole("SDE Intern")).toBe("Software Engineer (SDE)");
  });
});
