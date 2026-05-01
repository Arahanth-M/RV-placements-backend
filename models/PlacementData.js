import mongoose from "mongoose";

const placementDataSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    companyPlaced: {
      type: String,
      trim: true,
      required: true,
    },
    typeOfOffer: {
      type: String,
      trim: true,
      required: true,
    },
    stipend: {
      type: String,
      trim: true,
      default: "",
    },
    base: {
      type: String,
      trim: true,
      default: "",
    },
    ctc: {
      type: String,
      trim: true,
      default: "",
    },
    createdBy: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

placementDataSchema.index({ studentId: 1, companyPlaced: 1, typeOfOffer: 1 });

export default mongoose.model("PlacementData", placementDataSchema);
