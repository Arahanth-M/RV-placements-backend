import mongoose from "mongoose";

const user1Schema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    username: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      unique: true,
    },
    profilePicture: {
      type: String,
      trim: true,
      default: "",
    },
    points: {
      type: Number,
      default: 0,
    },
    role: {
      type: String,
      enum: ["student", "spc"],
      default: "student",
    },
    hasSubmittedMissingCompanyRequest: {
      type: Boolean,
      default: false,
    },
    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "users1",
  }
);

user1Schema.index({ email: 1 }, { unique: true });
user1Schema.index({ role: 1 });
user1Schema.index({ lastLoginAt: -1 });

export default mongoose.models.User1 || mongoose.model("User1", user1Schema);
