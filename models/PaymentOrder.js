import mongoose from "mongoose";
import { PLAN_IDS } from "../config/billingPlans.js";

const PAYMENT_ORDER_STATUS = ["created", "paid", "failed"];

const paymentOrderSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    email: { type: String, trim: true, default: "" },
    planId: {
      type: String,
      required: true,
      enum: Object.values(PLAN_IDS),
    },
    categoryId: { type: String, trim: true, default: "" },
    listPricePaise: { type: Number, required: true, min: 0 },
    creditPaise: { type: Number, required: true, min: 0, default: 0 },
    amountPaise: { type: Number, required: true, min: 100 },
    currency: { type: String, default: "INR" },
    razorpayOrderId: { type: String, required: true, unique: true, trim: true },
    razorpayPaymentId: { type: String, trim: true, default: "", index: true },
    razorpaySignature: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: PAYMENT_ORDER_STATUS,
      default: "created",
      index: true,
    },
    notes: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

paymentOrderSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.PaymentOrder ||
  mongoose.model("PaymentOrder", paymentOrderSchema, "billing_payment_orders");
