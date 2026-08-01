import mongoose from "mongoose";
import InterviewSlotBooking from "../models/InterviewSlotBooking.js";
import {
  BOOKING_WINDOW_DAYS,
  SLOT_CAPACITY,
  canCancelBooking,
  customRoundsRequireDsaSlot,
  formatSlotRangeIst,
  isNowWithinSlot,
  isSlotKeyBookable,
  listBookableSlotKeys,
  parseSlotKey,
  slotEndUtc,
  slotKeyToUtcDate,
  utcDateToSlotKey,
} from "../utils/istSlotTime.js";

const toClientBooking = (doc) => {
  if (!doc) return null;
  const slotStart = doc.slotStart instanceof Date ? doc.slotStart : new Date(doc.slotStart);
  return {
    id: String(doc._id),
    slotKey: doc.slotKey,
    slotStart: slotStart.toISOString(),
    slotEnd: slotEndUtc(slotStart).toISOString(),
    status: doc.status,
    label: formatSlotRangeIst(slotStart),
    canCancel: doc.status === "active" && canCancelBooking(slotStart),
    isActiveNow: doc.status === "active" && isNowWithinSlot(slotStart),
    createdAt: doc.createdAt,
  };
};

export async function getUserActiveBookingNow(userId) {
  const now = new Date();
  const bookings = await InterviewSlotBooking.find({
    userId: String(userId),
    status: "active",
    slotStart: { $lte: now },
  })
    .sort({ slotStart: -1 })
    .limit(5)
    .lean();

  return bookings.find((b) => isNowWithinSlot(b.slotStart, now)) || null;
}

export async function listUserBookings(userId, { includePast = true } = {}) {
  const filter = { userId: String(userId), status: "active" };
  const rows = await InterviewSlotBooking.find(filter).sort({ slotStart: 1 }).lean();
  const now = new Date();
  const mapped = rows.map(toClientBooking);
  if (!includePast) {
    return mapped.filter((b) => new Date(b.slotEnd) > now);
  }
  return mapped;
}

export async function getSlotAvailability() {
  const keys = listBookableSlotKeys();
  const slotStarts = keys.map((k) => slotKeyToUtcDate(k)).filter(Boolean);
  const counts = await InterviewSlotBooking.aggregate([
    {
      $match: {
        status: "active",
        slotStart: { $in: slotStarts },
      },
    },
    { $group: { _id: "$slotStart", count: { $sum: 1 } } },
  ]);
  const countByKey = new Map();
  for (const row of counts) {
    const key = utcDateToSlotKey(row._id);
    countByKey.set(key, row.count);
  }

  const slots = keys.map((slotKey) => {
    const bookedCount = countByKey.get(slotKey) || 0;
    const slotStart = slotKeyToUtcDate(slotKey);
    return {
      slotKey,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEndUtc(slotStart).toISOString(),
      bookedCount,
      capacity: SLOT_CAPACITY,
      isFull: bookedCount >= SLOT_CAPACITY,
      label: formatSlotRangeIst(slotStart),
    };
  });

  // Day totals for calendar (anonymous): past ~62 days + upcoming bookable window.
  const now = new Date();
  const dayFrom = new Date(now.getTime() - 62 * 24 * 60 * 60 * 1000);
  const dayTo = new Date(now.getTime() + BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const dayRows = await InterviewSlotBooking.aggregate([
    {
      $match: {
        status: "active",
        slotStart: { $gte: dayFrom, $lte: dayTo },
      },
    },
    {
      $group: {
        _id: { $substrBytes: ["$slotKey", 0, 10] },
        bookedCount: { $sum: 1 },
      },
    },
  ]);
  const dayCounts = {};
  for (const row of dayRows) {
    const day = String(row?._id || "").trim();
    const n = Number(row?.bookedCount) || 0;
    if (day && n > 0) dayCounts[day] = n;
  }

  return { slots, dayCounts };
}

async function createBookingAtomic(userId, slotKey) {
  const slotStart = slotKeyToUtcDate(slotKey);
  if (!slotStart || !parseSlotKey(slotKey)) {
    const err = new Error("Invalid slot.");
    err.code = "INVALID_SLOT";
    throw err;
  }
  if (!isSlotKeyBookable(slotKey)) {
    const err = new Error("This slot is outside the booking window.");
    err.code = "SLOT_NOT_BOOKABLE";
    throw err;
  }

  const session = await mongoose.startSession();
  try {
    let created = null;
    await session.withTransaction(async () => {
      const activeCount = await InterviewSlotBooking.countDocuments({
        slotStart,
        status: "active",
      }).session(session);
      if (activeCount >= SLOT_CAPACITY) {
        const err = new Error("This slot is full (5/5). Pick another hour.");
        err.code = "SLOT_FULL";
        throw err;
      }
      const dup = await InterviewSlotBooking.findOne({
        userId: String(userId),
        slotStart,
        status: "active",
      }).session(session);
      if (dup) {
        const err = new Error("You already booked this hour.");
        err.code = "ALREADY_BOOKED";
        throw err;
      }
      const docs = await InterviewSlotBooking.create(
        [
          {
            userId: String(userId),
            slotStart,
            slotKey,
            status: "active",
          },
        ],
        { session }
      );
      created = docs[0];
    });
    return toClientBooking(created);
  } finally {
    session.endSession();
  }
}

export async function bookSlot(userId, slotKey) {
  return createBookingAtomic(userId, slotKey);
}

export async function cancelBooking(userId, bookingId) {
  const booking = await InterviewSlotBooking.findOne({
    _id: bookingId,
    userId: String(userId),
    status: "active",
  });
  if (!booking) {
    const err = new Error("Booking not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (!canCancelBooking(booking.slotStart)) {
    const err = new Error("Cancellations are only allowed more than 2 hours before the slot.");
    err.code = "CANCEL_TOO_LATE";
    throw err;
  }
  booking.status = "cancelled";
  await booking.save();
  return toClientBooking(booking);
}

export async function rescheduleBooking(userId, bookingId, newSlotKey) {
  const existing = await InterviewSlotBooking.findOne({
    _id: bookingId,
    userId: String(userId),
    status: "active",
  });
  if (!existing) {
    const err = new Error("Booking not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (!canCancelBooking(existing.slotStart)) {
    const err = new Error("Reschedule is only allowed more than 2 hours before the slot.");
    err.code = "CANCEL_TOO_LATE";
    throw err;
  }

  const session = await mongoose.startSession();
  try {
    let created = null;
    await session.withTransaction(async () => {
      const slotStart = slotKeyToUtcDate(newSlotKey);
      if (!slotStart || !isSlotKeyBookable(newSlotKey)) {
        const err = new Error("Invalid or unavailable slot.");
        err.code = "SLOT_NOT_BOOKABLE";
        throw err;
      }
      const activeCount = await InterviewSlotBooking.countDocuments({
        slotStart,
        status: "active",
      }).session(session);
      if (activeCount >= SLOT_CAPACITY) {
        const err = new Error("This slot is full (5/5). Pick another hour.");
        err.code = "SLOT_FULL";
        throw err;
      }
      const dup = await InterviewSlotBooking.findOne({
        userId: String(userId),
        slotStart,
        status: "active",
      }).session(session);
      if (dup) {
        const err = new Error("You already booked this hour.");
        err.code = "ALREADY_BOOKED";
        throw err;
      }
      existing.status = "cancelled";
      await existing.save({ session });
      const docs = await InterviewSlotBooking.create(
        [
          {
            userId: String(userId),
            slotStart,
            slotKey: newSlotKey,
            status: "active",
          },
        ],
        { session }
      );
      created = docs[0];
    });
    return toClientBooking(created);
  } finally {
    session.endSession();
  }
}

export async function assertDsaSlotBookingForStart(userId, customRounds) {
  if (!customRoundsRequireDsaSlot(customRounds)) {
    return { ok: true, requiresSlot: false };
  }
  const active = await getUserActiveBookingNow(userId);
  if (!active) {
    const err = new Error(
      "Your plan includes a DSA round. Book a slot and start during that hour (IST)."
    );
    err.code = "DSA_SLOT_REQUIRED";
    err.requiresSlot = true;
    throw err;
  }
  return { ok: true, requiresSlot: true, activeBooking: toClientBooking(active) };
}

export async function getSlotBookingStatus(userId, customRounds) {
  const requiresSlot = customRoundsRequireDsaSlot(customRounds);
  const activeNow = await getUserActiveBookingNow(userId);
  const upcoming = await listUserBookings(userId, { includePast: false });
  return {
    requiresSlot,
    hasActiveBookingNow: Boolean(activeNow),
    activeBooking: activeNow ? toClientBooking(activeNow) : null,
    upcomingBookings: upcoming,
    canStartDsaInterview: !requiresSlot || Boolean(activeNow),
  };
}
