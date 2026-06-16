import mongoose from "mongoose";

const placementGeneralStatsSchema = new mongoose.Schema(
  {
    year: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    totalOffers: { type: Number, required: true },
    kpis: { type: mongoose.Schema.Types.Mixed, required: true },
    byDepartment: { type: [mongoose.Schema.Types.Mixed], required: true },
    ctcDistribution: { type: [mongoose.Schema.Types.Mixed], required: true },
    topCompanies: { type: [mongoose.Schema.Types.Mixed], required: true },
    monthlyTimeline: { type: [mongoose.Schema.Types.Mixed], required: true },
    departmentAvgCtc: { type: [mongoose.Schema.Types.Mixed], required: true },
    uploadedBy: { type: String, trim: true, default: "" },
    sourceFileName: { type: String, trim: true, default: "" },
  },
  { timestamps: true, collection: "placement_general_stats" }
);

export default mongoose.models.PlacementGeneralStats ||
  mongoose.model("PlacementGeneralStats", placementGeneralStatsSchema);
