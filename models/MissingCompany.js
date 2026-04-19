import mongoose from "mongoose";

const { Schema } = mongoose;

const missingCompanySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    requestCount: {
      type: Number,
      default: 1,
    },
    requestedBy: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    categories: [
      {
        type: String,
        trim: true,
      },
    ],
    status: {
      type: String,
      enum: ["PENDING", "ADDED", "REJECTED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

missingCompanySchema.index({ normalizedName: 1 }, { unique: true });
missingCompanySchema.index({ requestCount: -1 });

export default mongoose.model("MissingCompany", missingCompanySchema);
