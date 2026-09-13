import mongoose from "mongoose";

const billingTrialUsageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, trim: true },
    freeMockConsumed: { type: Boolean, default: false },
    freePrepConsumed: { type: Boolean, default: false },
    freeMockConsumedAt: { type: Date },
    freePrepConsumedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.models.BillingTrialUsage ||
  mongoose.model("BillingTrialUsage", billingTrialUsageSchema, "billing_trial_usage");
