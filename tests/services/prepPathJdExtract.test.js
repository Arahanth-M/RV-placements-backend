import { buildJdDigest } from "../../services/prepPath/resumeTextExtract.js";

describe("buildJdDigest", () => {
  it("keeps short JD text intact", () => {
    const text = "Requirements: DSA, OOP. Responsibilities: build APIs.";
    expect(buildJdDigest(text)).toBe(text);
  });

  it("prefers requirements/skills sections when trimming long JD text", () => {
    const filler = "x".repeat(3000);
    const text = `${filler}\nRequirements: Strong DSA and system design basics.\nSkills: Java, SQL.`;
    const digest = buildJdDigest(text, 500);
    expect(digest.length).toBeLessThanOrEqual(500);
    expect(digest.toLowerCase()).toContain("requirements");
    expect(digest.toLowerCase()).toContain("skills");
  });
});
