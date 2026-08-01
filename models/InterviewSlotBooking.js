import mongoose from "mongoose";

const interviewSlotBookingSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    /** UTC instant = start of the booked IST hour. */
    slotStart: { type: Date, required: true, index: true },
    /** Denormalized `YYYY-MM-DDTHH` (IST) for debugging / display. */
    slotKey: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["active", "cancelled"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

interviewSlotBookingSchema.index(
  { userId: 1, slotStart: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);

interviewSlotBookingSchema.index({ slotStart: 1, status: 1 });

export default mongoose.models.InterviewSlotBooking ||
  mongoose.model("InterviewSlotBooking", interviewSlotBookingSchema, "interview_slot_bookings");
