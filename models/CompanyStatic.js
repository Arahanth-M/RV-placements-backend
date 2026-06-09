import mongoose from "mongoose";
import { invalidateCompanyDetailCache } from "../services/companyDetailCache.js";

const submittedBySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: { type: String, trim: true },
  },
  { _id: false }
);

const companyStaticSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    nameKey: { type: String, trim: true },
    logo: { type: String, trim: true },
    about: { type: String, trim: true },
    must_do_topics: [{ type: String, trim: true }],
    business_model: { type: String, trim: true },
    prev_coding_ques: [{ type: mongoose.Schema.Types.Mixed }],
    helpfulCount: { type: Number, default: 0, min: 0 },
    helpfulUsers: [{ type: String }],
    /** Student emails that requested more company details (one request per email). */
    detailRequestUsers: [{ type: String }],
    submittedBy: submittedBySchema,
  },
  { timestamps: true }
);

companyStaticSchema.index({ nameKey: 1 }, { unique: true });

// Invalidate GET /api/companies/:id Redis cache when a `companies` row is removed
companyStaticSchema.post("deleteOne", { document: false, query: true }, async function (res) {
  try {
    if (!res || res.deletedCount === 0) return;
    const f = this.getFilter() || {};
    const id = f._id;
    if (id) await invalidateCompanyDetailCache(id);
  } catch {
    // Optional cache; never fail the delete
  }
});

companyStaticSchema.post(
  ["findOneAndDelete", "findByIdAndDelete"],
  async function (doc) {
    try {
      if (doc?._id) await invalidateCompanyDetailCache(doc._id);
    } catch {
      // Optional cache; never fail the delete
    }
  }
);

const CompanyStatic = mongoose.model(
  "CompanyStatic",
  companyStaticSchema,
  "companies"
);

export default CompanyStatic;
