import mongoose from "mongoose";

const collegeOnboardingRequestSchema = new mongoose.Schema(
  {
    path: {
      type: String,
      enum: ["demo", "self_onboard"],
      required: true,
      index: true,
    },
    collegeName: { type: String, required: true, trim: true, maxlength: 160 },
    pocName: { type: String, required: true, trim: true, maxlength: 120 },
    pocEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 320,
      index: true,
    },
    pocPhone: { type: String, trim: true, default: "", maxlength: 40 },
    willProvideData: { type: Boolean, default: undefined },
    dataExtent: { type: [String], default: undefined },
    selectedFeatures: { type: [String], default: undefined },
    approxPriceInr: { type: Number, default: undefined },
    status: {
      type: String,
      enum: [
        "demo_requested",
        "quotation_requested",
        "quotation_sent",
        "mou_pending",
        "payment_pending",
        "onboarded",
      ],
      default: "demo_requested",
      index: true,
    },
    notes: { type: String, trim: true, default: "", maxlength: 2000 },
  },
  {
    timestamps: true,
    collection: "college_onboarding_requests",
  }
);

collegeOnboardingRequestSchema.index({ createdAt: -1 });

export default mongoose.models.CollegeOnboardingRequest ||
  mongoose.model("CollegeOnboardingRequest", collegeOnboardingRequestSchema);
