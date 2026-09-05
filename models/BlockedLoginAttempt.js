import mongoose from "mongoose";

/** Auto-delete blocked-login rows after 30 days. Does not touch users1 / DAU. */
export const BLOCKED_LOGIN_TTL_SECONDS = 30 * 24 * 60 * 60;

const blockedLoginAttemptSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    emailDomain: { type: String, trim: true, lowercase: true, default: "" },
    googleId: { type: String, trim: true, default: "" },
    displayName: { type: String, trim: true, default: "" },
    reason: { type: String, trim: true, default: "domain" },
    flow: {
      type: String,
      enum: ["login", "signup", "admin"],
      default: "login",
    },
    collegeName: { type: String, trim: true, default: "" },
    wantsPlatformAtCollege: { type: Boolean, default: undefined },
    respondedAt: { type: Date, default: undefined },
  },
  {
    timestamps: true,
    collection: "blocked_login_attempts",
  }
);

blockedLoginAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: BLOCKED_LOGIN_TTL_SECONDS });
blockedLoginAttemptSchema.index({ createdAt: -1 });
blockedLoginAttemptSchema.index({ emailDomain: 1, createdAt: -1 });

export default mongoose.models.BlockedLoginAttempt ||
  mongoose.model("BlockedLoginAttempt", blockedLoginAttemptSchema);
