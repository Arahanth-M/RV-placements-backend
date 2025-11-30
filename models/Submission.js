import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
  },
  type: {
    type: String,
    enum: ["onlineQuestions", "interviewQuestions", "interviewProcess", "mustDoTopics"],
    required: true,
  },
  submittedBy: {
    name: { type: String, required: true },
    email: { type: String, required: true }
  },
  content: {
    type: String,
    required: true,
  },
  isAnonymous: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    enum: ["pending", "approved"],
    default: "pending",
  },
  submittedAt: {
    type: Date,
    default: Date.now,
  },
  approvedAt: {
    type: Date,
  },
});

const Submission = mongoose.model("Submission", submissionSchema);

export default Submission;
