import {
  mergeJdPayloadIntoRoles,
  normalizeAdminRoleInput,
  normalizeSkillsList,
  normalizeWorkDescription,
  planJdRoleFieldUpdate,
  splitJdPayloadFields,
  workDescriptionToPoints,
} from "../../utils/normalizeAdminRole.js";

describe("normalizeAdminRoleInput", () => {
  it("allows empty roleName when skills are present", () => {
    const role = normalizeAdminRoleInput({
      roleName: "",
      skills: ["DSA", "React"],
      workDescription: "Build features",
    });
    expect(role.roleName).toBe("");
    expect(role.skills).toBe("DSA\nReact");
    expect(role.workDescription).toBe("Build features");
  });

  it("rejects completely empty roles", () => {
    expect(() => normalizeAdminRoleInput({ roleName: "" }, 0)).toThrow(/empty/i);
  });

  it("persists CTC with a named role", () => {
    const role = normalizeAdminRoleInput({
      roleName: "SDE",
      ctc: { CTC: 20, Base: 12 },
    });
    expect(role.roleName).toBe("SDE");
    expect(role.ctc.CTC).toBe(20);
    expect(role.ctc.Base).toBe(12);
  });
});

describe("normalizeWorkDescription / normalizeSkillsList", () => {
  it("keeps a prose blurb as a single string", () => {
    expect(normalizeWorkDescription("Build and ship backend APIs.")).toBe(
      "Build and ship backend APIs."
    );
  });

  it("joins bullet arrays as newline-separated points", () => {
    expect(
      normalizeWorkDescription([
        "Own service reliability",
        "• Write design docs",
        "1. Mentor interns",
      ])
    ).toBe("Own service reliability\nWrite design docs\nMentor interns");
  });

  it("normalizes skills the same way as work points", () => {
    expect(normalizeSkillsList(["React", "• DSA"])).toBe("React\nDSA");
  });
});

describe("workDescriptionToPoints", () => {
  it("handles array input", () => {
    expect(workDescriptionToPoints(["A", "• B"])).toEqual(["A", "B"]);
  });

  it("splits newline-separated work", () => {
    expect(workDescriptionToPoints("A\nB\nC")).toEqual(["A", "B", "C"]);
  });
});

describe("splitJdPayloadFields + mergeJdPayloadIntoRoles", () => {
  it("maps skills/work and ignores CTC keys from JD payload", () => {
    const split = splitJdPayloadFields({
      skills: ["Go", "K8s"],
      workDescription: "Platform eng",
      CTC: 25,
      Base: "14",
    });
    expect(split.skills).toBe("Go\nK8s");
    expect(split.workDescription).toBe("Platform eng");
    expect(split.ctc).toEqual({});
    expect(split.hasSkillsKey).toBe(true);
    expect(split.hasWorkKey).toBe(true);
  });

  it("keeps non-canonical Save as keys under their own name", () => {
    const split = splitJdPayloadFields({
      Responsibilities: ["Ship features", "On-call"],
      "Bonus Skills": ["AWS", "K8s"],
    });
    expect(split.hasWorkKey).toBe(false);
    expect(split.workDescription).toBe("");
    expect(split.hasSkillsKey).toBe(false);
    expect(split.fields.Responsibilities).toBe("Ship features\nOn-call");
    expect(split.fields["Bonus Skills"]).toBe("AWS\nK8s");
    expect(split.hasAnyPointField).toBe(true);
  });

  it("does not fold Bonus Skills into skills", () => {
    const next = mergeJdPayloadIntoRoles(
      [{ roleName: "SDE", ctc: { CTC: 18 }, skills: "Java" }],
      "SDE",
      { "Bonus Skills": ["Kotlin"], skills: ["Go"] }
    );
    expect(next[0].skills).toBe("Java\nGo");
    expect(next[0]["Bonus Skills"]).toBe("Kotlin");
    expect(next[0].ctc.CTC).toBe(18);
  });
  it("merges skills/work without changing CTC even if Base is in payload", () => {
    const next = mergeJdPayloadIntoRoles(
      [{ roleName: "SDE", ctc: { CTC: 18 }, skills: "Java" }],
      "sde",
      { skills: ["Kotlin"], Base: 10, workDescription: "Backend" }
    );
    expect(next).toHaveLength(1);
    expect(next[0].roleName).toBe("SDE");
    expect(next[0].skills).toBe("Java\nKotlin");
    expect(next[0].ctc.CTC).toBe(18);
    expect(next[0].ctc.Base).toBeUndefined();
    expect(next[0].workDescription).toBe("Backend");
  });

  it("keeps existing CTC when apply payload has only skills (no CTC)", () => {
    const next = mergeJdPayloadIntoRoles(
      [{ roleName: "SDE", ctc: { CTC: 22, Base: 14 }, skills: "" }],
      "SDE",
      { skills: ["System Design"], workDescription: "Backend services" }
    );
    expect(next).toHaveLength(1);
    expect(next[0].ctc.CTC).toBe(22);
    expect(next[0].ctc.Base).toBe(14);
    expect(next[0].skills).toBe("System Design");
    expect(next[0].workDescription).toBe("Backend services");
  });

  it("ignores placeholder CTC in payload and keeps stored CTC", () => {
    const next = mergeJdPayloadIntoRoles(
      [{ roleName: "SDE", ctc: { CTC: 30, Base: 18 } }],
      "SDE",
      { skills: ["Go"], CTC: "Not mentioned", Base: "N/A" }
    );
    expect(next[0].ctc.CTC).toBe(30);
    expect(next[0].ctc.Base).toBe(18);
    expect(next[0].skills).toBe("Go");
  });

  it("attaches to the only existing role when roleName is blank", () => {
    const next = mergeJdPayloadIntoRoles(
      [{ roleName: "SDE", ctc: { CTC: 40 }, skills: "" }],
      "",
      { skills: ["DSA"] }
    );
    expect(next).toHaveLength(1);
    expect(next[0].roleName).toBe("SDE");
    expect(next[0].ctc.CTC).toBe(40);
    expect(next[0].skills).toBe("DSA");
  });

  it("creates unnamed role when roleName empty and no roles exist", () => {
    const next = mergeJdPayloadIntoRoles([], "", {
      skills: ["Python"],
      workDescription: "ML ops",
    });
    expect(next).toHaveLength(1);
    expect(next[0].roleName).toBe("");
    expect(next[0].skills).toBe("Python");
  });

  it("plans a patch with only skills/work keys (no ctc)", () => {
    const plan = planJdRoleFieldUpdate(
      [{ roleName: "SDE", ctc: { CTC: 22, Base: 14 }, skills: "Java" }],
      "SDE",
      { skills: ["Kotlin"], CTC: 99, Base: 1 }
    );
    expect(plan.kind).toBe("patch");
    expect(plan.index).toBe(0);
    expect(plan.fields).toEqual({ skills: "Java\nKotlin" });
    expect(plan.fields.ctc).toBeUndefined();
  });
});
