import mongoose from "mongoose";
import { mongoCollectionStudents } from "../config/mongoCollections.js";

const studentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
    },
    usn: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
    },
    /** Event `ObjectId`s the student marked as registered on the Events page (self-service). */
    registeredEventIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

studentSchema.index({ email: 1 });
studentSchema.index({ usn: 1 });

export default mongoose.model(
  "Student",
  studentSchema,
  mongoCollectionStudents
);
