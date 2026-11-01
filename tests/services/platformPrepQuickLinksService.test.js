import { normalizeQuickLinkRoles } from "../../services/platformPrepQuickLinksService.js";

describe("normalizeQuickLinkRoles", () => {
  it("dedupes roles from CSV finalize payload shape", () => {
    const roles = normalizeQuickLinkRoles([
      { key: "sde", label: "SDE" },
      { key: "sde", label: "SDE" },
      { key: "business-analyst", label: "Business Analyst" },
    ]);
    expect(roles).toEqual([
      { key: "sde", label: "SDE" },
      { key: "business-analyst", label: "Business Analyst" },
    ]);
  });

  it("accepts plain role strings", () => {
    expect(normalizeQuickLinkRoles(["Software Engineer", "  "])).toEqual([
      { key: "software-engineer", label: "Software Engineer" },
    ]);
  });
});
