/** IST offset from UTC (no DST). */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const SLOT_DURATION_MS = 60 * 60 * 1000;
export const BOOKING_WINDOW_DAYS = 7;
export const SLOT_CAPACITY = 5;
export const CANCEL_LEAD_MS = 2 * 60 * 60 * 1000;

const pad2 = (n) => String(n).padStart(2, "0");

/** Calendar parts for a UTC instant interpreted in IST. */
export function istDateParts(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  };
}

/** `YYYY-MM-DDTHH` in IST (hour 0–23). */
export function istSlotKey(year, month, day, hour) {
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}`;
}

export function parseSlotKey(slotKey) {
  const m = String(slotKey || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    hour < 0 ||
    hour > 23
  ) {
    return null;
  }
  return { year, month, day, hour };
}

/** UTC instant for the start of an IST hour slot. */
export function slotKeyToUtcDate(slotKey) {
  const p = parseSlotKey(slotKey);
  if (!p) return null;
  const utcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, 0, 0, 0) - IST_OFFSET_MS;
  return new Date(utcMs);
}

export function utcDateToSlotKey(date) {
  const p = istDateParts(date);
  return istSlotKey(p.year, p.month, p.day, p.hour);
}

export function slotEndUtc(slotStartUtc) {
  return new Date(slotStartUtc.getTime() + SLOT_DURATION_MS);
}

export function isNowWithinSlot(slotStartUtc, now = new Date()) {
  const start = slotStartUtc instanceof Date ? slotStartUtc : new Date(slotStartUtc);
  if (Number.isNaN(start.getTime())) return false;
  const end = slotEndUtc(start);
  return now >= start && now < end;
}

/** Human label e.g. "Mon, 27 Jul 2026 · 3:00–4:00 PM IST". */
export function formatSlotRangeIst(slotStartUtc) {
  const start = slotStartUtc instanceof Date ? slotStartUtc : new Date(slotStartUtc);
  const end = slotEndUtc(start);
  const fmt = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const fmtTime = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${fmt.format(start)} · ${fmtTime.format(start)}–${fmtTime.format(end)} IST`;
}

/**
 * Hourly slots from the current IST hour through the next {@link BOOKING_WINDOW_DAYS} days (inclusive).
 */
export function listBookableSlotKeys(now = new Date()) {
  const parts = istDateParts(now);
  const cursor = slotKeyToUtcDate(istSlotKey(parts.year, parts.month, parts.day, parts.hour));
  if (!cursor) return [];
  const keys = [];
  const maxHours = BOOKING_WINDOW_DAYS * 24;
  for (let i = 0; i < maxHours; i += 1) {
    const slotStart = new Date(cursor.getTime() + i * SLOT_DURATION_MS);
    const slotEnd = slotEndUtc(slotStart);
    if (slotEnd <= now) continue;
    const key = utcDateToSlotKey(slotStart);
    if (key && parseSlotKey(key)) keys.push(key);
  }
  return keys;
}

export function isSlotKeyBookable(slotKey, now = new Date()) {
  const allowed = new Set(listBookableSlotKeys(now));
  return allowed.has(String(slotKey || "").trim());
}

export function canCancelBooking(slotStartUtc, now = new Date()) {
  const start = slotStartUtc instanceof Date ? slotStartUtc : new Date(slotStartUtc);
  return start.getTime() - now.getTime() > CANCEL_LEAD_MS;
}

export function customRoundsRequireDsaSlot(customRounds) {
  if (!Array.isArray(customRounds)) return false;
  return customRounds.some((r) => String(r?.type || "").trim().toUpperCase() === "DSA");
}
