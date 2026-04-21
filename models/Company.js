// import mongoose from "mongoose";

// const selectedCandidateSchema = new mongoose.Schema(
//   {
//     name: {
//       type: String,
//       required: [true, "Candidate name is required"],
//       trim: true,
//       minlength: [2, "Name must be at least 2 characters"],
//       maxlength: [50, "Name cannot exceed 50 characters"],
//     },
//     emailId: {
//       type: String,
//       required: [true, "Email is required"],
//       trim: true,
//       match: [/.+@.+\..+/, "Invalid email address"],
//     },
//   },
//   { _id: false }
// );

// const roleSchema = new mongoose.Schema(
//   {
//     roleName: {
//       type: String,
//       required: [true, "Role name is required"],
//       trim: true,
//       minlength: [2, "Role name must be at least 2 characters"],
//       maxlength: [50, "Role name cannot exceed 50 characters"],
//     },
//     ctc: {
//       type: Map,
//       of: {
//         type: Number,
//         min: [0, "CTC components cannot be negative"],
//       },
//       default: {},
//     },
//     internshipStipend: {
//       type: Number,
//       min: [0, "Stipend cannot be negative"],
//     },
//     finalPayFirstYear: { type: String },
//     finalPayAnnual: { type: String }, // auto-calculated
//   },
//   { _id: false }
// );

// const companySchema = new mongoose.Schema(
//   {
//     name: {
//       type: String,
//       required: [true, "Company name is required"],
//       trim: true,
//       minlength: [2, "Company name must be at least 2 characters"],
//       maxlength: [50, "Company name cannot exceed 50 characters"],
//     },
//     type: {
//       type: String,
//       required: [true, "Company type is required"],
//     },
//     business_model: { type: String, trim: true, maxlength: 100 },
//     eligibility: { type: String, trim: true, maxlength: 500 },

//     roles: [roleSchema], // Multiple roles with flexible CTCs

//     jobDescription: [
//       {
//         title: { type: String, required: true, trim: true, maxlength: 100 },
//         fileUrl: { type: String, required: true, trim: true },
//         fileType: {
//           type: String,
//           enum: ["pdf", "doc", "docx"],
//           required: true,
//         },
//       },
//     ],

//     onlineQuestions: [
//       {
//         type: String,
//         trim: true,
//         maxlength: 500,
//         validate: {
//           validator: (v) => !/<script.*?>.*?<\/script>/gi.test(v),
//           message: "Malicious script detected in online questions",
//         },
//       },
//     ],

//     onlineQuestion_solution: [
//       {
//         type: String,
//         trim: true,
//         maxlength: 500,
//       },
//     ],

//     mcqQuestions: [
//       {
//         question: { type: String, trim: true, maxlength: 300 },
//         optionA: { type: String, trim: true, maxlength: 100 },
//         optionB: { type: String, trim: true, maxlength: 100 },
//         optionC: { type: String, trim: true, maxlength: 100 },
//         optionD: { type: String, trim: true, maxlength: 100 },
//         answer: { type: String, trim: true, maxlength: 100 },
//       },
//     ],

//     interviewQuestions: [
//       {
//         type: String,
//         trim: true,
//         maxlength: 500,
//         validate: {
//           validator: (v) => !/<script.*?>.*?<\/script>/gi.test(v),
//           message: "Malicious script detected in interview questions",
//         },
//       },
//     ],

//     interviewProcess: { type: String, trim: true, maxlength: 500 },
//     count: {
//       type: Number,
//       min: [0, "Selected candidates count cannot be negative"],
//     },
//     selectedCandidates: [selectedCandidateSchema],
//     Must_Do_Topics: [
//       {
//         type: String,
//         trim: true,
//         maxlength: 200,
//         validate: {
//           validator: (v) => !/<script.*?>.*?<\/script>/gi.test(v),
//           message: "Malicious script detected in Must Do Topics",
//         },
//       },
//     ],
//     date_of_visit: { type: String, trim: true },
//     status: {
//       type: String,
//       enum: ["pending", "approved", "rejected"],
//       default: "pending",
//     },
//     submittedBy: {
//       name: { type: String, trim: true },
//       email: { type: String, trim: true },
//     },
//   },
//   { timestamps: true }
// );

// // Auto-calc CTC + Final Pay for each role
// companySchema.pre("save", function (next) {
//   if (this.roles && this.roles.length > 0) {
//     this.roles = this.roles.map((role) => {
//       const ctcObj = Object.fromEntries(role.ctc || []);

//       const { base = 0, bonus = 0, stock = 0, other = 0 } = ctcObj;
//       const total = Object.values(ctcObj).reduce((acc, val) => acc + val, 0);

//       const vestingYears = 4;
//       const firstYearPay =
//         base + bonus + other + (stock > 0 ? stock / vestingYears : 0);
//       const annualPay = base + other + (stock > 0 ? stock / vestingYears : 0);

//       return {
//         ...role.toObject(),
//         ctc: { ...ctcObj, total },
//         finalPayFirstYear: `${firstYearPay}`,
//         finalPayAnnual: `${annualPay}`,
//       };
//     });
//   }
//   next();
// });

// const Company = mongoose.model("Company", companySchema);
// export default Company;

import mongoose from "mongoose";
import { invalidateCompanyDetailCache } from "../services/companyDetailCache.js";
import { dispatchEvent } from "../services/events/eventDispatcher.js";
import { EVENT_TYPES } from "../services/events/eventTypes.js";

const selectedCandidateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Candidate name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
    },
    emailId: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      match: [/.+@.+\..+/, "Invalid email address"],
    },
  },
  { _id: false }
);

const roleSchema = new mongoose.Schema(
  {
    roleName: {
      type: String,
      required: [true, "Role name is required"],
      trim: true,
      minlength: [2, "Role name must be at least 2 characters"],
    },
    ctc: {
      type: Map,
      of: mongoose.Schema.Types.Mixed, // Allow both String and Number types
      default: {},
    },
    internshipStipend: {
      type: Number,
      min: [0, "Stipend cannot be negative"],
    },
  },
  { _id: false }
);

const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      minlength: [2, "Company name must be at least 2 characters"],
    },
    type: {
      type: String,
      required: [true, "Company type is required"],
    },
    business_model: { type: String, trim: true },
    eligibility: { type: String, trim: true },
    offCampus: { type: Boolean, default: false },
    roles: [roleSchema],
    jobDescription: [
      {
        title: { type: String, required: true, trim: true },
        fileUrl: { type: String, required: true, trim: true },
        fileType: {
          type: String,
          enum: ["pdf", "doc", "docx"],
          required: true,
        },
      },
    ],
    onlineQuestions: [
      {
        type: String,
        trim: true,
        validate: {
          validator: (v) => !/<script.*?>.*?<\/script>/gi.test(v),
          message: "Malicious script detected in online questions",
        },
      },
    ],
    onlineQuestions_solution: [
      { type: String, trim: true },
    ],
    prev_coding_ques: [
      { type: mongoose.Schema.Types.Mixed },
    ],
    mcqQuestions: [
      {
        question: { type: String, trim: true },
        optionA: { type: String, trim: true },
        optionB: { type: String, trim: true },
        optionC: { type: String, trim: true },
        optionD: { type: String, trim: true },
        answer: { type: String, trim: true },
      },
    ],
    interviewQuestions: [
      {
        type: String,
        trim: true,
        validate: {
          validator: (v) => !/<script.*?>.*?<\/script>/gi.test(v),
          message: "Malicious script detected in interview questions",
        },
      },
    ],
    interviewQuestions_solution: [
      { type: String, trim: true },
    ],
    interviewProcess: [{ type: String, trim: true }],
    internshipExperience: [
      {
        type: String,
        trim: true
      }
    ],
    count: { type: String},
    selectedCandidates: [selectedCandidateSchema],
    Must_Do_Topics: [
      {
        type: String,
        trim: true,
      
        validate: {
          validator: (v) => !/<script.*?>.*?<\/script>/gi.test(v),
          message: "Malicious script detected in Must Do Topics",
        },
      },
    ],
    date_of_visit: { type: String, trim: true },
    approvedAt: { type: Date },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    submittedBy: {
      name: { type: String, trim: true },
      email: { type: String, trim: true },
    },
    logo: { type: String, trim: true },
    domain: { type: String, trim: true }, // e.g. "google.com" for logo.dev
    helpfulCount: { type: Number, default: 0, min: 0 },
    helpfulUsers: [{ type: String }], // Array of user emails who have upvoted
    cluster: { 
      type: String, 
      trim: true,
      enum: ["Computer Science and Engineering", "Electronics and Communication", "Mechanical Engineering"],
      default: undefined
    },
    views: { type: Number, default: 0, min: 0 },
    totalStudentsApplied: { type: Number, default: 0, min: 0 },
    totalClearedOA: { type: Number, default: 0, min: 0 },
    totalGotIn: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// -------------------- DYNAMIC CTC HANDLING -------------------- //
companySchema.pre("save", async function () {
  if (this.roles && this.roles.length > 0) {
    this.roles = this.roles.map((role) => {
      // Convert Map to plain object
      const ctcObj = role.ctc instanceof Map ? Object.fromEntries(role.ctc) : role.ctc || {};

      return {
        ...role.toObject(),
        ctc: { ...ctcObj }, // preserve all original keys (strings preserved as-is)
      };
    });
  }

  if (!this.isNew && this.isModified("status")) {
    const prior = await this.constructor
      .findById(this._id)
      .select("status")
      .lean();
    this._prevCompanyStatusForEvent = prior?.status;
  } else {
    this._prevCompanyStatusForEvent = undefined;
  }
});

companySchema.pre(["findOneAndUpdate", "findByIdAndUpdate"], async function () {
  try {
    const oldDoc = await this.model
      .findOne(this.getFilter())
      .select("status")
      .lean();
    this._companyEventOldStatus = oldDoc?.status;
  } catch {
    this._companyEventOldStatus = undefined;
  }
});

/** Payload keys for OA / Interview / Process / Must Do tabs — invalidate detail cache only when these change */
const COMPANY_DETAIL_TAB_FIELDS = [
  "onlineQuestions",
  "onlineQuestions_solution",
  "interviewQuestions",
  "interviewQuestions_solution",
  "interviewProcess",
  "Must_Do_Topics",
];

function modifiedPathTouchesDetailTabs(path) {
  if (!path || typeof path !== "string") return false;
  return COMPANY_DETAIL_TAB_FIELDS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}.`)
  );
}

function saveDocumentTouchesDetailTabs(doc) {
  if (!doc || typeof doc.modifiedPaths !== "function") return false;
  return doc.modifiedPaths().some(modifiedPathTouchesDetailTabs);
}

function collectUpdateRootKeys(update) {
  const keys = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("$")) {
        if (v && typeof v === "object" && !Array.isArray(v)) walk(v);
      } else {
        keys.push(k);
      }
    }
  }
  walk(update);
  return keys;
}

function updateObjectTouchesDetailTabs(update) {
  return collectUpdateRootKeys(update).some(modifiedPathTouchesDetailTabs);
}

/** Resolves post-update status when findOneAndUpdate uses `new: false` (doc may still be old). */
function statusAfterUpdateFromQuery(doc, query) {
  const fromDoc = doc?.status;
  const update = typeof query.getUpdate === "function" ? query.getUpdate() : {};
  if (update && typeof update === "object") {
    if (typeof update.status === "string") return update.status;
    if (update.$set && typeof update.$set.status === "string") return update.$set.status;
  }
  return fromDoc;
}

// After save(), modifiedPaths() is empty — read intent in pre("save") and act in post("save").
companySchema.pre("save", function () {
  if (!this.$locals) this.$locals = {};
  this.$locals._invalidateCompanyDetailCacheAfterSave = saveDocumentTouchesDetailTabs(this);
});

// Invalidate Redis `company:<id>` only when OA / Interview / Process tab data changes (see above)
companySchema.post("save", async function (doc) {
  try {
    const fromPreSave = doc.$locals?._invalidateCompanyDetailCacheAfterSave === true;
    if (doc.$locals && Object.prototype.hasOwnProperty.call(doc.$locals, "_invalidateCompanyDetailCacheAfterSave")) {
      delete doc.$locals._invalidateCompanyDetailCacheAfterSave;
    }
    if (!fromPreSave) return;
    await invalidateCompanyDetailCache(doc._id);
  } catch {
    // Never fail the save if Redis invalidation errors
  }
});

companySchema.post(["findOneAndUpdate", "findByIdAndUpdate"], async function (doc) {
  try {
    const update = typeof this.getUpdate === "function" ? this.getUpdate() : {};
    if (!updateObjectTouchesDetailTabs(update)) return;
    const id = doc?._id ?? this.getFilter?.()?._id;
    await invalidateCompanyDetailCache(id);
  } catch {
    // Never fail the update if Redis invalidation errors
  }
});

companySchema.post(["findOneAndDelete", "findByIdAndDelete"], async function (doc) {
  try {
    const id = doc?._id ?? this.getFilter?.()?._id;
    await invalidateCompanyDetailCache(id);
  } catch {
    // Never fail the delete if Redis invalidation errors
  }
});

companySchema.post("save", function (doc) {
  const oldStatus = doc._prevCompanyStatusForEvent;
  if (oldStatus === "pending" && doc.status === "approved") {
    dispatchEvent(EVENT_TYPES.COMPANY_APPROVED, {
      companyId: doc._id,
      companyName: doc.name,
    }).catch(console.error);
  }
});

companySchema.post(["findOneAndUpdate", "findByIdAndUpdate"], function (doc) {
  const newStatus = statusAfterUpdateFromQuery(doc, this);
  const oldStatus = this._companyEventOldStatus;
  if (oldStatus !== "pending" || newStatus !== "approved") return;

  const companyId = doc?._id ?? this.getFilter?.()?._id;
  if (!companyId) return;

  dispatchEvent(EVENT_TYPES.COMPANY_APPROVED, {
    companyId,
    companyName: doc?.name ?? "",
  }).catch(console.error);
});

const Company = mongoose.model("Company", companySchema, "companies1");
export default Company;

