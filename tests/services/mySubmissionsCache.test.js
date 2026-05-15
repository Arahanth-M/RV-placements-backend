import {
  normalizeSubmitterEmail,
  submitterEmailFromSubmission,
} from "../../services/mySubmissionsCache.js";

describe("mySubmissionsCache", () => {
  it("normalizeSubmitterEmail trims and lowercases", () => {
    expect(normalizeSubmitterEmail("  Test@Example.COM ")).toBe("test@example.com");
    expect(normalizeSubmitterEmail(null)).toBe("");
  });

  it("submitterEmailFromSubmission reads submittedBy.email", () => {
    expect(
      submitterEmailFromSubmission({
        submittedBy: { email: "User@RVCE.edu.in" },
      })
    ).toBe("user@rvce.edu.in");
    expect(submitterEmailFromSubmission(null)).toBe("");
  });
});
