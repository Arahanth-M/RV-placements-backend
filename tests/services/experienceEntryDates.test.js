import { describe, it, expect } from "@jest/globals";
import {
  attachExperienceEntryDates,
  resolveExperienceEntryDates,
} from "../../services/experienceEntryDates.js";

describe("resolveExperienceEntryDates", () => {
  it("uses JSON updatedAt on the stored entry when present", () => {
    const entry = JSON.stringify({
      content: "Round 1: OA",
      updatedAt: "2026-03-12T10:00:00.000Z",
    });
    expect(resolveExperienceEntryDates([entry], [])).toEqual([
      "2026-03-12T10:00:00.000Z",
    ]);
  });

  it("matches approved submissions by narrative text without changing the entry", () => {
    const entry = JSON.stringify({
      content: "Round 1: OA with graphs",
      submittedBy: { name: "A", email: "a@example.com" },
    });
    const dates = resolveExperienceEntryDates([entry], [
      {
        content: JSON.stringify({ question: "Round 1: OA with graphs" }),
        approvedAt: "2026-04-01T08:00:00.000Z",
        submittedAt: "2026-03-30T08:00:00.000Z",
      },
    ]);
    expect(dates).toEqual(["2026-04-01T08:00:00.000Z"]);
  });

  it("matches internship { experience } payloads to visit content JSON", () => {
    const entry = JSON.stringify({ content: "Great intern project" });
    const dates = resolveExperienceEntryDates([entry], [
      {
        content: JSON.stringify({ experience: "Great intern project" }),
        submittedAt: "2026-01-15T00:00:00.000Z",
      },
    ]);
    expect(dates).toEqual(["2026-01-15T00:00:00.000Z"]);
  });

  it("keeps later of stored JSON date and submission date", () => {
    const entry = JSON.stringify({
      content: "Same text",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    const dates = resolveExperienceEntryDates([entry], [
      {
        content: "Same text",
        approvedAt: "2026-05-01T00:00:00.000Z",
      },
    ]);
    expect(dates).toEqual(["2026-05-01T00:00:00.000Z"]);
  });

  it("returns null when nothing can be dated", () => {
    expect(resolveExperienceEntryDates(["legacy blob"], [])).toEqual([null]);
  });
});

describe("attachExperienceEntryDates", () => {
  it("adds parallel arrays and leaves stored strings untouched", () => {
    const processEntry = JSON.stringify({ content: "Round 1: HR" });
    const internEntry = "plain intern note";
    const out = attachExperienceEntryDates(
      { interviewProcess: [processEntry], internshipExperience: [internEntry] },
      {
        interviewProcess: [
          {
            content: JSON.stringify({ content: "Round 1: HR" }),
            approvedAt: "2026-06-02T00:00:00.000Z",
          },
        ],
        internshipExperience: [],
      }
    );
    expect(out.interviewProcess).toEqual([processEntry]);
    expect(out.internshipExperience).toEqual([internEntry]);
    expect(out.interviewProcessUpdatedAt).toEqual(["2026-06-02T00:00:00.000Z"]);
    expect(out.internshipExperienceUpdatedAt).toEqual([null]);
  });
});
