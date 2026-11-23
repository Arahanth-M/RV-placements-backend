import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * PrepPath resume digests for reuse (DPDP access/erasure).
 * A user may keep multiple digests (one per upload). Raw resume files and JD
 * text are never stored — only the short digest + file meta.
 */
const userPrepResumeDigestSchema = new Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    digest: { type: String, trim: true, maxlength: 4000, required: true },
    resumeMeta: {
      fileName: { type: String, trim: true, maxlength: 200, default: "" },
      mime: { type: String, trim: true, maxlength: 120, default: "" },
      textChars: { type: Number, default: 0 },
    },
    source: {
      type: String,
      enum: ["prep_path"],
      default: "prep_path",
    },
  },
  { timestamps: true }
);

userPrepResumeDigestSchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.models.UserPrepResumeDigest ||
  mongoose.model("UserPrepResumeDigest", userPrepResumeDigestSchema, "user_prep_resume_digests");
