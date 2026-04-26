import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "CompanyStatic",
    required: true,
  },
  type: {
    type: String,
    enum: ["onlineQuestions", "interviewQuestions", "interviewProcess", "mustDoTopics", "internshipExperience"],
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
  /** Placement cycle for visit-backed types (OA, interview, etc.); defaults to 2026 in approval logic when unset. */
  placementYear: {
    type: Number,
    min: 2026,
    max: 2027,
  },
});

const Submission = mongoose.model("Submission", submissionSchema);

export default Submission;
