import mongoose from "mongoose";

const collegeFeatureConfigSchema = new mongoose.Schema(
  {
    collegeId: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    collegeName: { type: String, trim: true, default: "", maxlength: 160 },
    selectedFeatures: { type: [String], default: [] },
    /** Bumped whenever selectedFeatures changes — used for student “don’t show again” invalidation. */
    featuresUpdatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "college_feature_configs",
  }
);

export default mongoose.models.CollegeFeatureConfig ||
  mongoose.model("CollegeFeatureConfig", collegeFeatureConfigSchema);
