import mongoose from "mongoose";
import { PLAN_IDS } from "../config/billingPlans.js";

const entitlementSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    planId: {
      type: String,
      required: true,
      enum: Object.values(PLAN_IDS),
    },
    categoryId: { type: String, trim: true, default: "" },
    grants: {
      allCards: { type: Boolean, default: false },
      mocks: { type: Boolean, default: false },
      prepPath: { type: Boolean, default: false },
    },
    startsAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    paymentOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentOrder" },
    razorpayPaymentId: { type: String, trim: true, default: "" },
    source: {
      type: String,
      enum: ["razorpay", "admin"],
      default: "razorpay",
    },
  },
  { timestamps: true }
);

entitlementSchema.index({ userId: 1, expiresAt: 1 });
entitlementSchema.index({ razorpayPaymentId: 1, planId: 1, categoryId: 1 });

export default mongoose.models.Entitlement ||
  mongoose.model("Entitlement", entitlementSchema, "billing_entitlements");
