import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
  },
  type: {
    type: String,
    enum: ["onlineQuestions", "interviewQuestions", "interviewProcess"],
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
  submittedAt: {
    type: Date,
    default: Date.now,
  },
});

const Submission = mongoose.model("Submission", submissionSchema);

export default Submission;
