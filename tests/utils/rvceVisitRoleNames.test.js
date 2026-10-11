import {
  collectRvceVisitRoleNames,
  isPlaceholderVisitRoleName,
  mergeResearchRoleOptions,
} from "../../utils/rvceVisitRoleNames.js";

describe("rvceVisitRoleNames", () => {
  it("keeps RVCE visit roles and skips TBD and RVITM rows", () => {
    expect(isPlaceholderVisitRoleName("TBD")).toBe(true);
    expect(isPlaceholderVisitRoleName(" t.b.d ")).toBe(true);
    expect(
      collectRvceVisitRoleNames([
        {
          roles: [
            { roleName: "Software Engineer", collegeId: "rvce" },
            { roleName: "TBD", collegeId: "rvce" },
            { roleName: "Data Analyst" },
            { roleName: "Software Intern", collegeId: "rvitm" },
            "SDE",
          ],
        },
        {
          roles: [
            { roleName: "software engineer", collegeId: "rvce" },
            { roleName: "To be decided" },
            { name: "Analyst", collegeId: "RVCE" },
          ],
        },
      ])
    ).toEqual(["Analyst", "Data Analyst", "SDE", "Software Engineer"]);
  });

  it("lists campus roles before fresher suggestions and drops duplicates", () => {
    expect(
      mergeResearchRoleOptions(
        ["Software Engineer", "TBD", "Data Analyst"],
        ["Data Analyst", "SDE"]
      )
    ).toEqual(["Software Engineer", "Data Analyst", "SDE"]);
  });
});
