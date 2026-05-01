import mongoose from "mongoose";
import { invalidateCompanyDetailCache } from "../services/companyDetailCache.js";

const companyVisitSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyStatic",
      required: true,
    },
    year: { type: Number, required: true },
    /** Part of composite uniqueness with companyId + year + cluster (empty string when unset). */
    type: { type: String, trim: true, default: "" },
    roles: [{ type: mongoose.Schema.Types.Mixed }],
    onlineQuestions: [{ type: String, trim: true }],
    onlineQuestions_solution: [{ type: String, trim: true }],
    interviewQuestions: [{ type: String, trim: true }],
    interviewQuestions_solution: [{ type: String, trim: true }],
    interviewProcess: [{ type: String, trim: true }],
    eligibility: { type: String, trim: true },
    date_of_visit: { type: String, trim: true },
    /** Optional; e.g. from `companies1_copy` / backfill. Type preserved (Date, string, etc.) */
    messageDate: { type: mongoose.Schema.Types.Mixed },
    /** Part of composite uniqueness with companyId + year + type (empty string when unset). */
    cluster: { type: String, trim: true, default: "" },
    count: { type: String, trim: true },
    selectedCandidates: [{ type: mongoose.Schema.Types.Mixed }],
    status: { type: String, trim: true },
    totalClearedOA: { type: Number, default: 0, min: 0 },
    totalGotIn: { type: Number, default: 0, min: 0 },
    totalStudentsApplied: { type: Number, default: 0, min: 0 },
    ppoConversionGotIn: { type: Number, default: 0, min: 0 },
    ppoConversionConverted: { type: Number, default: 0, min: 0 },
    ppoConversionAcceptanceRate: { type: Number, default: 0, min: 0 },
    ppoConversionType: { type: String, trim: true },
    ppoBranchStats: [
      {
        branchCode: { type: String, trim: true, lowercase: true },
        gotIn: { type: Number, default: 0, min: 0 },
        converted: { type: Number, default: 0, min: 0 },
      },
    ],
    views: { type: Number, default: 0, min: 0 },
    internshipExperience: [{ type: String, trim: true }],
    mcqQuestions: [{ type: mongoose.Schema.Types.Mixed }],
  },
  { timestamps: true, strict: false }
);

companyVisitSchema.index({ year: 1 });
companyVisitSchema.index(
  { companyId: 1, year: 1, type: 1, cluster: 1 },
  { unique: true }
);

companyVisitSchema.pre("deleteOne", { document: false, query: true }, async function () {
  const f = this.getFilter() || {};
  if (f.companyId) {
    this._invCompanyIdForCache = f.companyId;
    return;
  }
  if (f._id) {
    const v = await this.model
      .findOne({ _id: f._id })
      .select("companyId")
      .lean();
    this._invCompanyIdForCache = v?.companyId;
  }
});

companyVisitSchema.post("deleteOne", { document: false, query: true }, async function (res) {
  try {
    if (!res || res.deletedCount === 0) return;
    const cid = this._invCompanyIdForCache;
    if (cid) await invalidateCompanyDetailCache(cid);
  } catch {
    // Optional cache; never fail the delete
  }
});

companyVisitSchema.post("deleteMany", { document: false, query: true }, async function (res) {
  try {
    if (!res || res.deletedCount === 0) return;
    const f = this.getFilter() || {};
    if (f.companyId) await invalidateCompanyDetailCache(f.companyId);
  } catch {
    // Optional cache; never fail the delete
  }
});

companyVisitSchema.post(
  ["findOneAndDelete", "findByIdAndDelete"],
  async function (doc) {
    try {
      if (doc?.companyId) await invalidateCompanyDetailCache(doc.companyId);
    } catch {
      // Optional cache; never fail the delete
    }
  }
);

const CompanyVisit = mongoose.model(
  "CompanyVisit",
  companyVisitSchema,
  "company_visits"
);

export default CompanyVisit;
