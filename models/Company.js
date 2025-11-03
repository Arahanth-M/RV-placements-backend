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
//     videoKey: { type: String, trim: true },
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

const selectedCandidateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Candidate name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [50, "Name cannot exceed 50 characters"],
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
      maxlength: [50, "Role name cannot exceed 50 characters"],
    },
    ctc: {
      type: Map,
      of: {
        type: Number,
        min: [0, "CTC components cannot be negative"],
      },
      default: {},
    },
    internshipStipend: {
      type: Number,
      min: [0, "Stipend cannot be negative"],
    },
    finalPayFirstYear: { type: String },
    finalPayAnnual: { type: String },
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
      maxlength: [50, "Company name cannot exceed 50 characters"],
    },
    type: {
      type: String,
      required: [true, "Company type is required"],
    },
    business_model: { type: String, trim: true, maxlength: 100 },
    eligibility: { type: String, trim: true, maxlength: 500 },
    roles: [roleSchema],
    jobDescription: [
      {
        title: { type: String, required: true, trim: true, maxlength: 100 },
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
        maxlength: 500,
        validate: {
          validator: (v) => !/<script.*?>.*?<\/script>/gi.test(v),
          message: "Malicious script detected in online questions",
        },
      },
    ],
    onlineQuestion_solution: [
      { type: String, trim: true, maxlength: 500 },
    ],
    mcqQuestions: [
      {
        question: { type: String, trim: true, maxlength: 300 },
        optionA: { type: String, trim: true, maxlength: 100 },
        optionB: { type: String, trim: true, maxlength: 100 },
        optionC: { type: String, trim: true, maxlength: 100 },
        optionD: { type: String, trim: true, maxlength: 100 },
        answer: { type: String, trim: true, maxlength: 100 },
      },
    ],
    interviewQuestions: [
      {
        type: String,
        trim: true,
        maxlength: 500,
        validate: {
          validator: (v) => !/<script.*?>.*?<\/script>/gi.test(v),
          message: "Malicious script detected in interview questions",
        },
      },
    ],
    interviewProcess: { type: String, trim: true, maxlength: 500 },
    count: { type: String},
    selectedCandidates: [selectedCandidateSchema],
    Must_Do_Topics: [
      {
        type: String,
        trim: true,
        maxlength: 200,
        validate: {
          validator: (v) => !/<script.*?>.*?<\/script>/gi.test(v),
          message: "Malicious script detected in Must Do Topics",
        },
      },
    ],
    date_of_visit: { type: String, trim: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    submittedBy: {
      name: { type: String, trim: true },
      email: { type: String, trim: true },
    },
    videoKey: { type: String, trim: true },
    logo: { type: String, trim: true },
  },
  { timestamps: true }
);

// -------------------- DYNAMIC CTC HANDLING -------------------- //
companySchema.pre("save", function (next) {
  if (this.roles && this.roles.length > 0) {
    this.roles = this.roles.map((role) => {
      // Convert Map to plain object
      const ctcObj = role.ctc instanceof Map ? Object.fromEntries(role.ctc) : role.ctc || {};

      // Total = sum of all CTC components dynamically
      const total = Object.values(ctcObj).reduce((acc, val) => acc + (val || 0), 0);

      // Optional: First year pay and annual pay
      const stock = ctcObj.stock || 0;
      const vestingYears = 4;
      const firstYearPay = Object.values(ctcObj).reduce((acc, val) => acc + (val || 0), 0) - stock + stock / vestingYears;
      const annualPay = total - (ctcObj.bonus || 0); // example, can adjust rules

      return {
        ...role.toObject(),
        ctc: { ...ctcObj, total }, // preserve all original keys + total
        finalPayFirstYear: `${firstYearPay}`,
        finalPayAnnual: `${annualPay}`,
      };
    });
  }
  next();
});

const Company = mongoose.model("Company", companySchema);
export default Company;

