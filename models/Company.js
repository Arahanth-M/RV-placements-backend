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
      of: mongoose.Schema.Types.Mixed, // Allow both String and Number types
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
        validate: {
          validator: (v) => !/<script.*?>.*?<\/script>/gi.test(v),
          message: "Malicious script detected in online questions",
        },
      },
    ],
    onlineQuestions_solution: [
      { type: String, trim: true },
    ],
    mcqQuestions: [
      {
        question: { type: String, trim: true },
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
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    submittedBy: {
      name: { type: String, trim: true },
      email: { type: String, trim: true },
    },
    videoKey: { type: String, trim: true },
    logo: { type: String, trim: true },
    helpfulCount: { type: Number, default: 0, min: 0 },
    helpfulUsers: [{ type: String }], // Array of user emails who have upvoted
  },
  { timestamps: true }
);

// -------------------- DYNAMIC CTC HANDLING -------------------- //
companySchema.pre("save", function (next) {
  if (this.roles && this.roles.length > 0) {
    this.roles = this.roles.map((role) => {
      // Convert Map to plain object
      const ctcObj = role.ctc instanceof Map ? Object.fromEntries(role.ctc) : role.ctc || {};

      // Helper function to safely convert value to number (only if it's a number)
      const toNumber = (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const parsed = parseFloat(val);
          return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      // Total = sum of all numeric CTC components (skip string values)
      const total = Object.values(ctcObj).reduce((acc, val) => {
        if (typeof val === 'number') {
          return acc + val;
        }
        // If it's a string that can be parsed as number, include it
        if (typeof val === 'string') {
          const numVal = parseFloat(val);
          return acc + (isNaN(numVal) ? 0 : numVal);
        }
        return acc;
      }, 0);

      // Optional: First year pay and annual pay (only calculate if we have numeric values)
      const stock = toNumber(ctcObj.stock);
      const vestingYears = 4;
      const firstYearPay = total - stock + (stock / vestingYears);
      const bonus = toNumber(ctcObj.bonus);
      const annualPay = total - bonus;

      return {
        ...role.toObject(),
        ctc: { ...ctcObj, total }, // preserve all original keys + total (strings preserved as-is)
        finalPayFirstYear: `${firstYearPay}`,
        finalPayAnnual: `${annualPay}`,
      };
    });
  }
  next();
});

const Company = mongoose.model("Company", companySchema, "companies1");
export default Company;

