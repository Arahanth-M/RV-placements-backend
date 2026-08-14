import mongoose from "mongoose";

const placementGeneralStatsSchema = new mongoose.Schema(
  {
    year: {
      type: Number,
      required: true,
      index: true,
    },
    collegeId: {
      type: String,
      trim: true,
      lowercase: true,
      default: "rvce",
      index: true,
    },
    totalOffers: { type: Number, required: true },
    kpis: { type: mongoose.Schema.Types.Mixed, required: true },
    byDepartment: { type: [mongoose.Schema.Types.Mixed], required: true },
    ctcDistribution: { type: [mongoose.Schema.Types.Mixed], required: true },
    ctcByDepartment: { type: [mongoose.Schema.Types.Mixed], default: [] },
    companyPlacementRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    companyOfferTotals: { type: [mongoose.Schema.Types.Mixed], default: [] },
    topCompanies: { type: [mongoose.Schema.Types.Mixed], required: true },
    monthlyTimeline: { type: [mongoose.Schema.Types.Mixed], required: true },
    monthlyByDepartment: { type: [mongoose.Schema.Types.Mixed], default: [] },
    departmentAvgCtc: { type: [mongoose.Schema.Types.Mixed], required: true },
    uploadedBy: { type: String, trim: true, default: "" },
    sourceFileName: { type: String, trim: true, default: "" },
  },
  { timestamps: true, collection: "placement_general_stats" }
);

placementGeneralStats