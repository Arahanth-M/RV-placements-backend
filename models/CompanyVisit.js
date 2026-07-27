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
    must_do_topics: [{ type: String, trim: true }],
    eligibility: { type: String, trim: true },
    date_of_visit: { type: String, trim: true },
    /** Optional; e.g. from `companies1_copy` / backfill. Type preserved (Date, string, etc.) */
    messageDate: { type: mongoose.Schema.Types.Mixed },
    /**
     * Hub / branch cluster for this visit row (part of composite uniqueness with companyId + year + type + university).
     * Often stored as a full department name (e.g. `"Computer Science and Engineering"`), not `cs`/`ec`.
     * Empty string when unset — APIs treat empty as CS for legacy compatibility.
     */
    cluster: { type: String, trim: true, default: "" },
    /**
     * College / university hub for multi-college isolation (`A`–`E`).
     * Part of composite uniqueness with companyId + year + type + cluster.
     */
    university: { type: String, trim: true, uppercase: true, default: "" },
    branch: { type: String, trim: true, default: "" },
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
    /** Dream / open-dream / off-campus / internship-only got-in by branch (SPC add placement / FTE conversion); not PPO conversion stats. */
    placementGotInBranchStats: [
      {
        branchCode: { type: String, trim: true, lowercase: true },
        gotIn: { type: Number, default: 0, min: 0 },
      },
    ],
    views: { type: Number, default: 0, min: 0 },
    internshipExperience: [{ type: String, trim: true }],
    mcqQuestions: [{ type: mongoose.Schema.Types.Mixed }],
    /** Structured hiring pipeline (OA + rounds); written only via SPC/Admin recruitment-process API. */
    recruitment_process: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true, strict: false }
);

companyVisitSchema.index({ year: 1 });
companyVisitSchema.index({ university: 1, year: 1 });
companyVisitSchema.index(
  { companyId: 1, year: 1, type: 1, cluster: 1, university: 1 },
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
  "company_visits_uni"
);

export default CompanyVisit;
