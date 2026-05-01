import mongoose from "mongoose";

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
    phoneNumber: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

studentSchema.index({ email: 1 });
studentSchema.index({ usn: 1 });

export default mongoose.model("Student", studentSchema);
