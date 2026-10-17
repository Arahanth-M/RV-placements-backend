import mongoose from "mongoose";

const TEST_EMAIL_DURATION_HOURS = [2, 6, 8, 12, 24];

const testEmailGrantSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    durationHours: { type: Number, required: true, enum: TEST_EMAIL_DURATION_HOURS },
    /** Sign-in window ends at this time. Renewing the grant moves this forward. */
    expiresAt: { type: Date, required: true, index: true },
    /** Latest time an admin set or renewed this window. */
    grantedAt: { type: Date, required: true },
    /**
     * Feature usage is counted from the first grant and is not reset on renew.
     * Each test email gets one mock, PrepPath, challenge, and behavioural coach.
     */
    usageAnchorAt: { type: Date, required: true },
    createdBy: { type: String, trim: true, default: "" },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.TestEmailGrant ||
  mongoose.model("TestEmailGrant", testEmailGrantSchema, "test_email_grants");
