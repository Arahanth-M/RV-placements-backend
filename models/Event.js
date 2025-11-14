import mongoose from "mongoose";

const eventSchema = new mongoose.Schema(
  {
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
        validator: function(v) {
          // Basic URL validation
          return /^https?:\/\/.+/.test(v);
        },
        message: "Please provide a valid URL starting with http:// or https://"
      }
    },
    lastDateToRegister: {
      type: Date,
      required: [true, "Last date to register is required"],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Index for efficient queries
eventSchema.index({ lastDateToRegister: 1, createdAt: -1 });

const Event = mongoose.model("Event", eventSchema);
export default Event;

