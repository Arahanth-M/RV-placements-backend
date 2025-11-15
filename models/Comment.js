import mongoose from "mongoose";

const commentSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company reference is required"],
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User reference is required"],
    },
    username: {
      type: String,
      required: [true, "Username is required"],
    },
    comment: {
      type: String,
      required: [true, "Comment text is required"],
      trim: true,
      minlength: [1, "Comment cannot be empty"],
      maxlength: [2000, "Comment cannot exceed 2000 characters"],
    },
  },
  { timestamps: true }
);

// Index for efficient queries
commentSchema.index({ company: 1, createdAt: -1 });
commentSchema.index({ user: 1 });

const Comment = mongoose.model("Comment", commentSchema);
export default Comment;

