import {
  scopeVisitsByBranchCluster,
  spcVisitScopeErrorMessage,
} from "../../services/spcVisitScope.js";

describe("spcVisitScope", () => {
  const visits = [
    { _id: "1", cluster: "cs" },
    { _id: "2", cluster: "ec" },
    { _id: "3", cluster: "me" },
  ];

  it("scopes to cs hub for cse branch", () => {
    const { visits: scoped, hub, strictMiss } = scopeVisitsByBranchCluster(visits, "cse");
    expect(hub).toBe("cs");
    expect(strictMiss).toBe(false);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]._id).toBe("1");
  });

  it("strict mode returns empty when hub has no visit", () => {
    const onlyEc = [{ _id: "2", cluster: "ec" }];
    const { visits: scoped, strictMiss } = scopeVisitsByBranchCluster(onlyEc, "cse", {
      strict: true,
    });
    expect(strictMiss).toBe(true);
    expect(scoped).toHaveLength(0);
  });

  it("non-strict falls back to full list when hub missing", () => {
    const onlyEc = [{ _id: "2", cluster: "ec" }];
    const { visits: scoped, strictMiss } = scopeVisitsByBranchCluster(onlyEc, "cse", {
      strict: false,
    });
    expect(strictMiss).toBe(false);
    expect(scoped).toHaveLength(1);
  });

  it("error message mentions year and hub", () => {
    const msg = spcVisitScopeErrorMessage(2026, "cse");
    expect(msg).toMatch(/2026/);
    expect(msg).toMatch(/cs/i);
  });
});
