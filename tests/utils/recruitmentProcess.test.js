import { describe, expect, it } from "vitest";
import {
  isRecruitmentProcessEmpty,
  sanitizeRecruitmentProcess,
  buildRecruitmentProcessSubmitter,
  withRecruitmentProcessSubmitter,
  getRecruitmentProcessSubmitter,
} from "../utils/recruitmentProcess.js";

describe("sanitizeRecruitmentProcess", () => {
  it("accepts OA-only process with mode", () => {
    const result = sanitizeRecruitmentProcess({
      onlineAssessment: {
        occurred: true,
        mode: "offline",
        topics: "DSA, Aptitude",
        attended: 200,
        cleared: 80,
      },
      rounds: [{ roundNumber: 1, occurred: false }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.onlineAssessment.mode).toBe("offline");
    }
  });

  it("rejects OA without mode", () => {
    const result = sanitizeRecruitmentProcess({
      onlineAssessment: {
        occurred: true,
        topics: "DSA",
        attended: 10,
        cleared: 5,
      },
      rounds: [],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts OA-only process", () => {
    const result = sanitizeRecruitmentProcess({
      onlineAssessment: {
        occurred: true,
        mode: "online",
        topics: "DSA, Aptitude",
        attended: 200,
        cleared: 80,
      },
      rounds: [{ roundNumber: 1, occurred: false }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.onlineAssessment.attended).toBe(200);
      expect(result.value.onlineAssessment.cleared).toBe(80);
    }
  });

  it("rejects cleared greater than attended", () => {
    const result = sanitizeRecruitmentProcess({
      onlineAssessment: { occurred: false },
      rounds: [
        {
          roundNumber: 1,
          occurred: true,
          type: "technical",
          mode: "online",
          attended: 10,
          cleared: 15,
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("requires round mode when round occurred", () => {
    const result = sanitizeRecruitmentProcess({
      onlineAssessment: { occurred: false },
      rounds: [
        {
          roundNumber: 1,
          occurred: true,
          type: "technical",
          attended: 10,
          cleared: 5,
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("requires other label when type is other", () => {
    const result = sanitizeRecruitmentProcess({
      onlineAssessment: { occurred: false },
      rounds: [
        {
          roundNumber: 1,
          occurred: true,
          type: "other",
          attended: 10,
          cleared: 5,
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts blank attended/cleared as unknown", () => {
    const result = sanitizeRecruitmentProcess({
      onlineAssessment: {
        occurred: true,
        mode: "online",
        topics: "DSA",
        attended: "",
        cleared: "",
      },
      rounds: [
        {
          roundNumber: 1,
          occurred: true,
          types: ["technical"],
          mode: "online",
          attended: null,
          cleared: "",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.onlineAssessment.attended).toBeUndefined();
      expect(result.value.onlineAssessment.cleared).toBeUndefined();
      expect(result.value.rounds[0].attended).toBeUndefined();
      expect(result.value.rounds[0].cleared).toBeUndefined();
    }
  });

  it("accepts multiple round types", () => {
    const result = sanitizeRecruitmentProcess({
      onlineAssessment: { occurred: false },
      rounds: [
        {
          roundNumber: 1,
          occurred: true,
          types: ["technical", "projects"],
          mode: "online",
          attended: 10,
          cleared: 5,
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rounds[0].types).toEqual(["technical", "projects"]);
      expect(result.value.rounds[0].type).toBe("technical");
    }
  });

  it("normalizes legacy single type into types array", () => {
    const result = sanitizeRecruitmentProcess({
      onlineAssessment: { occurred: false },
      rounds: [
        {
          roundNumber: 1,
          occurred: true,
          type: "aptitude",
          mode: "offline",
          attended: 8,
          cleared: 3,
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rounds[0].types).toEqual(["aptitude"]);
      expect(result.value.rounds[0].type).toBe("aptitude");
    }
  });
});

describe("isRecruitmentProcessEmpty", () => {
  it("returns true for missing data", () => {
    expect(isRecruitmentProcessEmpty(null)).toBe(true);
    expect(
      isRecruitmentProcessEmpty({
        onlineAssessment: { occurred: false },
        rounds: [{ occurred: false }],
      })
    ).toBe(true);
  });
});

describe("buildRecruitmentProcessSubmitter", () => {
  it("prefers student name and usn", () => {
    const sb = buildRecruitmentProcessSubmitter(
      { email: "spc@rvce.edu.in", username: "jwt-name" },
      { name: "Student Name", email: "spc@rvce.edu.in", usn: "1rv22cs001" }
    );
    expect(sb).toEqual({
      name: "Student Name",
      email: "spc@rvce.edu.in",
      usn: "1RV22CS001",
    });
  });

  it("withRecruitmentProcessSubmitter attaches metadata", () => {
    const out = withRecruitmentProcessSubmitter(
      { onlineAssessment: { occurred: false }, rounds: [] },
      { email: "a@b.com", username: "Alice" },
      { name: "Alice", email: "a@b.com", usn: "USN1" }
    );
    expect(getRecruitmentProcessSubmitter(out)?.name).toBe("Alice");
    expect(out.submittedAt).toBeTruthy();
  });
});
