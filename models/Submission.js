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
  /** Set when a submission is approved (admin session or SPC). */
  reviewedBy: {
    role: { type: String, enum: ["admin", "spc"] },
    name: { type: String },
    email: { type: String },
  },
  /** Placement cycle for visit-backed types (OA, interview, etc.); defaults to 2026 in approval logic when unset. */
  placementYear: {
    type: Number,
    min: 2026,
    max: 2028,
  },
  /**
   * Hub/list tier when submitting from company detail (`dream` / `open_dream` / `summer_internship`).
   * Lets admin approval attach content to the matching FTE vs PPO visit row when both exist for the same year.
   */
  placementListContext: {
    type: String,
    enum: ["dream", "open_dream", "summer_internship"],
    required: false,
  },
  /** Exact `company_visits` row the student saw on detail (preferred over tier heuristics on approve). */
  companyVisitId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false,
  },
});

const Submission = mongoose.model("Submission", submissionSchema);

export default Submission;
