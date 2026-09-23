import { describe, expect, it } from "@jest/globals";
import {
  applyStudyScheduleToDays,
  dayMinutesFromHours,
  listStudyScheduleOptions,
  normalizeStudyScheduleChoice,
  packTasksIntoSlots,
} from "../../services/prepPath/studySchedule.js";

describe("listStudyScheduleOptions", () => {
  it("offers stretch plus even batches for a 2h day", () => {
    const options = listStudyScheduleOptions(2);
    expect(options[0]).toMatchObject({
      style: "stretch",
      slotsPerDay: 1,
      slotMinutes: 120,
    });
    expect(options.map((o) => `${o.slotsPerDay}x${o.slotMinutes}`)).toEqual([
      "1x120",
      "2x60",
      "3x40",
      "4x30",
    ]);
  });

  it("only offers stretch when the day is a single 30 min block", () => {
    const options = listStudyScheduleOptions(0.5);
    expect(options).toHaveLength(1);
    expect(options[0].style).toBe("stretch");
    expect(options[0].slotMinutes).toBe(30);
  });
});

describe("normalizeStudyScheduleChoice", () => {
  it("accepts a matching batch split", () => {
    expect(
      normalizeStudyScheduleChoice({
        hoursPerDay: 2,
        style: "batches",
        slotsPerDay: 2,
        slotMinutes: 60,
      })
    ).toMatchObject({ style: "batches", slotsPerDay: 2, slotMinutes: 60 });
  });

  it("rejects a split that does not fill the day", () => {
    expect(() =>
      normalizeStudyScheduleChoice({
        hoursPerDay: 2,
        style: "batches",
        slotsPerDay: 2,
        slotMinutes: 45,
      })
    ).toThrow(/study style/);
  });
});

describe("packTasksIntoSlots", () => {
  it("keeps stretch days as one slot", () => {
    const slots = packTasksIntoSlots(
      [
        { title: "Arrays", minutes: 60, notes: "hash maps" },
        { title: "HR", minutes: 60 },
      ],
      [120]
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].tasks.map((t) => t.title)).toEqual(["Arrays", "HR"]);
    expect(slots[0].tasks[0].notes).toBe("hash maps");
  });

  it("packs equal tasks into two hour-long slots", () => {
    const slots = packTasksIntoSlots(
      [
        { title: "A", minutes: 30 },
        { title: "B", minutes: 30 },
        { title: "C", minutes: 30 },
        { title: "D", minutes: 30 },
      ],
      [60, 60]
    );
    expect(slots[0].tasks.map((t) => t.title)).toEqual(["A", "B"]);
    expect(slots[1].tasks.map((t) => t.title)).toEqual(["C", "D"]);
  });

  it("splits a long task across slots and marks the continuation", () => {
    const slots = packTasksIntoSlots([{ title: "Mock OA", minutes: 90 }], [60, 60]);
    expect(slots[0].tasks).toEqual([
      expect.objectContaining({ title: "Mock OA", minutes: 60 }),
    ]);
    expect(slots[1].tasks).toEqual([
      expect.objectContaining({ title: "Mock OA (cont.)", minutes: 30 }),
    ]);
  });
});

describe("applyStudyScheduleToDays", () => {
  it("attaches slots without dropping existing day fields", () => {
    const days = applyStudyScheduleToDays(
      [
        {
          day: 1,
          hours: 2,
          focus: "DSA",
          campusEvidence: [{ label: "OA" }],
          tasks: [
            { title: "Two Sum", minutes: 60 },
            { title: "HR", minutes: 60 },
          ],
        },
      ],
      { style: "batches", slotsPerDay: 2, slotMinutes: 60 },
      2
    );
    expect(days[0].focus).toBe("DSA");
    expect(days[0].campusEvidence).toEqual([{ label: "OA" }]);
    expect(days[0].slots).toHaveLength(2);
    expect(dayMinutesFromHours(2)).toBe(120);
  });
});
