import mongoose from "mongoose";

/** Physical MongoDB collection for announcements (legacy `events` is unused). */
export const EVENT1_COLLECTION = "event1";

const eventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      trim: true,
      maxlength: [80, "Type cannot exceed 80 characters"],
      default: "",
    },
    organizer: {
      type: String,
      trim: true,
      maxlength: [120, "Organizer cannot exceed 120 characters"],
      default: "",
    },
    title: {
      type: String,
      required: [true, "Event title is required"],
      trim: true,
      minlength: [2, "Title must be at least 2 characters"],
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    url: {
      type: String,
      required: [true, "Event URL is required"],
      trim: true,
      validate: {
        validator: function (v) {
          return /^https?:\/\/.+/.test(v);
        },
        message: "Please provide a valid URL starting with http:// or https://",
      },
    },
    lastDateToRegister: {
      type: Date,
      required: [true, "Last date to register is required"],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User1",
    },
  },
  { timestamps: true, collection: EVENT1_COLLECTION }
);

eventSchema.index({ lastDateToRegister: 1, createdAt: -1 });

const Event1 =
  mongoose.models.Event1 || mongoose.model("Event1", eventSchema, EVENT1_COLLECTION);

export default Event1;
