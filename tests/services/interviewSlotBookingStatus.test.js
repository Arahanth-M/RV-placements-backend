import { composeSlotBookingStatus } from "../../services/interviewSlotBookingService.js";

describe("composeSlotBookingStatus", () => {
  const currentHourOpen = { slotKey: "2026-09-13T13", bookedCount: 2, capacity: 5, isFull: false };
  const currentHourFull = { slotKey: "2026-09-13T13", bookedCount: 5, capacity: 5, isFull: true };
  const activeNow = { id: "b1", slotKey: "2026-09-13T13" };

  test("non-DSA plans can always start", () => {
    const status = composeSlotBookingStatus({
      requiresSlot: false,
      activeNow: null,
      currentHour: currentHourFull,
    });
    expect(status.canStartDsaInterview).toBe(true);
    expect(status.requiresSlot).toBe(false);
  });

  test("DSA with open current hour can start without a pre-booked slot", () => {
    const status = composeSlotBookingStatus({
      requiresSlot: true,
      activeNow: null,
      currentHour: currentHourOpen,
    });
    expect(status.canStartDsaInterview).toBe(true);
    expect(status.hasActiveBookingNow).toBe(false);
  });

  test("DSA blocks start when current hour is 5/5 and user has no active booking", () => {
    const status = composeSlotBookingStatus({
      requiresSlot: true,
      activeNow: null,
      currentHour: currentHourFull,
    });
    expect(status.canStartDsaInterview).toBe(false);
  });

  test("DSA still allows start when current hour is full if user already holds it", () => {
    const status = composeSlotBookingStatus({
      requiresSlot: true,
      activeNow,
      currentHour: currentHourFull,
    });
    expect(status.canStartDsaInterview).toBe(true);
    expect(status.hasActiveBookingNow).toBe(true);
  });
});
