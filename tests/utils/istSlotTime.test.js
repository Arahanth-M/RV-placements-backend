import {
  canCancelBooking,
  customRoundsRequireDsaSlot,
  isNowWithinSlot,
  istSlotKey,
  listBookableSlotKeys,
  parseSlotKey,
  slotKeyToUtcDate,
  utcDateToSlotKey,
} from "../utils/istSlotTime.js";

describe("istSlotTime", () => {
  test("slotKey round-trip IST hour", () => {
    const key = istSlotKey(2026, 7, 27, 15);
    const utc = slotKeyToUtcDate(key);
    expect(utcDateToSlotKey(utc)).toBe(key);
  });

  test("current hour is bookable when still inside window", () => {
    const now = slotKeyToUtcDate("2026-07-27T15");
    now.setMinutes(20);
    const keys = listBookableSlotKeys(now);
    expect(keys).toContain("2026-07-27T15");
  });

  test("customRoundsRequireDsaSlot", () => {
    expect(customRoundsRequireDsaSlot([{ type: "HR" }])).toBe(false);
    expect(customRoundsRequireDsaSlot([{ type: "DSA" }, { type: "HR" }])).toBe(true);
  });

  test("isNowWithinSlot", () => {
    const start = slotKeyToUtcDate("2026-07-27T10");
    const inside = new Date(start.getTime() + 30 * 60 * 1000);
    const outside = new Date(start.getTime() + 61 * 60 * 1000);
    expect(isNowWithinSlot(start, inside)).toBe(true);
    expect(isNowWithinSlot(start, outside)).toBe(false);
  });

  test("canCancelBooking respects 2h lead", () => {
    const start = slotKeyToUtcDate("2026-07-27T15");
    const ok = new Date(start.getTime() - 3 * 60 * 60 * 1000);
    const late = new Date(start.getTime() - 60 * 60 * 1000);
    expect(canCancelBooking(start, ok)).toBe(true);
    expect(canCancelBooking(start, late)).toBe(false);
  });

  test("parseSlotKey rejects invalid", () => {
    expect(parseSlotKey("bad")).toBeNull();
    expect(parseSlotKey("2026-07-27T25")).toBeNull();
  });
});
