import mongoose from "mongoose";

const interviewExperienceLikeSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyStatic",
      required: true,
    },
    experienceKey: { type: String, required: true, trim: true },
    userEmail: { type: String, required: true, trim: true, lowercase: true },
  },
  { timestamps: true }
);

interviewExperienceLikeSchema.index(
  { companyId: 1, experienceKey: 1, userEmail: 1 },
  { unique: true }
);

const InterviewExperienceLike = mongoose.model(
  "InterviewExperienceLike",
  interviewExperienceLikeSchema
);

export default InterviewExperienceLike;
