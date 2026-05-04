import mongoose from "mongoose";
import { mongoCollectionPlacementData } from "../config/mongoCollections.js";

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
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyStatic",
      default: null,
    },
    placementYear: {
      type: Number,
      default: null,
    },
    branchCode: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    role: {
      type: String,
      trim: true,
      default: "",
    },
    ppoConversionType: {
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
placementDataSchema.index(
  { studentId: 1, companyId: 1, placementYear: 1 },
  { unique: true, sparse: true }
);

export default mongoose.model(
  "PlacementData",
  placementDataSchema,
  mongoCollectionPlacementData
);
