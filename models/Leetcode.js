import mongoose from "mongoose";

const leetcodeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Problem title is required"],
      trim: true,
      minlength: [2, "Title must be at least 2 characters"],
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    link: {
      type: String,
      required: [true, "LeetCode problem link is required"],
      trim: true,
      validate: {
        validator: function (v) {
          // Validate URL format
          return /^https?:\/\/.+\..+/.test(v);
        },
        message: "Please provide a valid URL",
      },
    },
    company: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      minlength: [2, "Company name must be at least 2 characters"],
      maxlength: [100, "Company name cannot exceed 100 characters"],
    },
    likelihood: {
      type: String,
      required: [true, "Likelihood is required"],
      trim: true,
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: {
        values: ["DSA", "SQL"],
        message: "Category must be either DSA or SQL",
      },
      trim: true,
    },
  },
  { timestamps: true }
);

// Create indexes for better query performance
leetcodeSchema.index({ company: 1 });
leetcodeSchema.index({ likelihood: 1 });
leetcodeSchema.index({ title: 1 });
leetcodeSchema.index({ category: 1 });

// Explicitly specify collection name to match MongoDB
const Leetcode = mongoose.model("Leetcode", leetcodeSchema, "leetcode");

export default Leetcode;

