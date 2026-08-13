import {
  hubClusterKeysForCollege,
  isHubClusterAllowedForCollege,
} from "../../utils/placementCluster.js";
import {
  inferSpcClusterFromEmailAndUsn,
  isSpcActor,
  normalizeAssignedSpcCluster,
  placementHubClusterFromEmail,
  placementHubClusterFromUsn,
} from "../../utils/spcCluster.js";
import {
  branchMatchesSpcCluster,
  scopeVisitsBySpcCluster,
  visitMatchesSpcCluster,
} from "../../services/spcVisitScope.js";

describe("spcCluster inference", () => {
  it("maps RVCE email local-part branch+year to hub", () => {
    expect(placementHubClusterFromEmail("arahanthm.cs22@rvce.edu.in")).toBe("cs");
    expect(placementHubClusterFromEmail("name.ec21@rvce.edu.in")).toBe("ec");
    expect(placementHubClusterFromEmail("name.me20@rvce.edu.in")).toBe("me");
    expect(placementHubClusterFromEmail("name.ch22@rvce.edu.in")).toBe("chem");
    expect(placementHubClusterFromEmail("name.cv22@rvce.edu.in")).toBe("chem");
    expect(placementHubClusterFromEmail("name.is22@rvce.edu.in")).toBe("cs");
  });

  it("maps RVITM dotted local-part to hub", () => {
    expect(placementHubClusterFromEmail("name.cs22.rvitm@rvei.edu.in")).toBe("cs");
  });

  it("returns null when email has no branch token", () => {
    expect(placementHubClusterFromEmail("admin@rvce.edu.in")).toBeNull();
    expect(placementHubClusterFromEmail("")).toBeNull();
  });

  it("maps USN branch code to hub", () => {
    expect(placementHubClusterFromUsn("1RV22CS001")).toBe("cs");
    expect(placementHubClusterFromUsn("1RV21EC010")).toBe("ec");
    expect(placementHubClusterFromUsn("1RV20ME099")).toBe("me");
    expect(placementHubClusterFromUsn("1RV22CV011")).toBe("chem");
  });

  it("prefers email over USN", () => {
    expect(
      inferSpcClusterFromEmailAndUsn("name.ec22@rvce.edu.in", "1RV22CS001")
    ).toBe("ec");
  });
});

describe("spcCluster college hubs", () => {
  it("RVITM only allows cs and ec", () => {
    expect(hubClusterKeysForCollege("rvitm")).toEqual(["cs", "ec"]);
    expect(isHubClusterAllowedForCollege("me", "rvitm")).toBe(false);
    expect(isHubClusterAllowedForCollege("cs", "rvitm")).toBe(true);
    expect(normalizeAssignedSpcCluster("me", "rvitm")).toBeNull();
    expect(normalizeAssignedSpcCluster("cs", "rvitm")).toBe("cs");
  });

  it("RVCE allows all four hubs", () => {
    expect(hubClusterKeysForCollege("rvce")).toEqual(["cs", "ec", "me", "chem"]);
    expect(normalizeAssignedSpcCluster("chem", "rvce")).toBe("chem");
  });
});

describe("isSpcActor", () => {
  it("is true only for SPC role without admin session", () => {
    expect(isSpcActor({ role: "spc" })).toBe(true);
    expect(isSpcActor({ role: "spc", isAdminSession: true })).toBe(false);
    expect(isSpcActor({ role: "student" })).toBe(false);
  });
});

describe("spcVisitScope assigned cluster", () => {
  const visits = [
    { _id: "1", cluster: "Computer Science and Engineering" },
    { _id: "2", cluster: "Electronics and Communication" },
    { _id: "3", cluster: "" },
  ];

  it("scopes visits to assigned hub and treats empty cluster as cs", () => {
    const { visits: scoped, hub } = scopeVisitsBySpcCluster(visits, "cs", { strict: true });
    expect(hub).toBe("cs");
    expect(scoped.map((v) => v._id).sort()).toEqual(["1", "3"]);
  });

  it("strict miss when hub has no visits", () => {
    const { visits: scoped, strictMiss } = scopeVisitsBySpcCluster(visits, "me", {
      strict: true,
    });
    expect(strictMiss).toBe(true);
    expect(scoped).toHaveLength(0);
  });

  it("matches visit and branch to assigned hub", () => {
    expect(visitMatchesSpcCluster(visits[1], "ec")).toBe(true);
    expect(visitMatchesSpcCluster(visits[1], "cs")).toBe(false);
    expect(branchMatchesSpcCluster("cs", "cs")).toBe(true);
    expect(branchMatchesSpcCluster("me", "cs")).toBe(false);
  });
});
