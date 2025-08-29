import mongoose from "mongoose";

const selectedCandidateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    emailId: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const roleSchema = new mongoose.Schema(
  {
    roleName: { type: String, required: true, trim: true },

    // 🔹 Flexible CTC: variable keys depending on company
    ctc: {
      type: Map,
      of: Number,  // each key in the map will be a number
      default: {}
    },

    internshipStipend: { type: Number },

    finalPayFirstYear: { type: String }, // auto-calculated
    finalPayAnnual: { type: String }     // auto-calculated
  },
  { _id: false }
);

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true },
    eligibility: { type: String, required: true },

    roles: [roleSchema],   // Multiple roles with flexible CTCs
    
    jobDescription: [
      {
        title: { type: String, required: true },
        fileUrl: { type: String, required: true },
        fileType: { type: String, enum: ["pdf", "doc", "docx"], required: true }
      }
    ],

    onlineQuestions: [{ type: String }],

    // ⬅️ MCQ Questions (all optional)
    mcqQuestions: [
      {
        question: { type: String },
        optionA: { type: String },
        optionB: { type: String },
        optionC: { type: String },
        optionD: { type: String },
        answer: { type: String } // e.g., "A", "B", "C", "D" or full option text
      }
    ],

    interviewQuestions: [{ type: String }],
    interviewProcess: { type: String },
    count: {type: String},
    selectedCandidates: [selectedCandidateSchema]
  },
  { timestamps: true }
);


// Auto-calc CTC + Final Pay for each role
companySchema.pre("save", function (next) {
  if (this.roles && this.roles.length > 0) {
    this.roles = this.roles.map(role => {
      const ctcObj = Object.fromEntries(role.ctc || []); // convert Map -> plain object

      // pick values dynamically
      const { base = 0, bonus = 0, stock = 0, other = 0 } = ctcObj;
      const total = Object.values(ctcObj).reduce((acc, val) => acc + val, 0);

      const vestingYears = 4;
      const firstYearPay =
        base + bonus + other + (stock > 0 ? stock / vestingYears : 0);
      const annualPay =
        base + other + (stock > 0 ? stock / vestingYears : 0);

      return {
        ...role.toObject(),
        ctc: { ...ctcObj, total },
        finalPayFirstYear: `${firstYearPay}`,
        finalPayAnnual: `${annualPay}`
      };
    });
  }
  next();
});

const Company = mongoose.model("Company", companySchema);
export default Company;
