import mongoose from "mongoose";

const { Schema } = mongoose;

const bulletSchema = new Schema(
  {
    text: { type: String, trim: true, maxlength: 250, required: true },
  },
  { _id: false }
);

const educationSchema = new Schema(
  {
    institution: { type: String, trim: true, maxlength: 140, default: "" },
    degree: { type: String, trim: true, maxlength: 120, default: "" },
    field: { type: String, trim: true, maxlength: 120, default: "" },
    startDate: { type: String, trim: true, maxlength: 30, default: "" },
    endDate: { type: String, trim: true, maxlength: 30, default: "" },
    score: { type: String, trim: true, maxlength: 40, default: "" },
    location: { type: String, trim: true, maxlength: 120, default: "" },
  },
  { _id: false }
);

const projectSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 140, default: "" },
    techStack: { type: String, trim: true, maxlength: 180, default: "" },
    link: { type: String, trim: true, maxlength: 300, default: "" },
    startDate: { type: String, trim: true, maxlength: 30, default: "" },
    endDate: { type: String, trim: true, maxlength: 30, default: "" },
    bullets: { type: [bulletSchema], default: [] },
  },
  { _id: false }
);

const experienceSchema = new Schema(
  {
    company: { type: String, trim: true, maxlength: 140, default: "" },
    role: { type: String, trim: true, maxlength: 120, default: "" },
    location: { type: String, trim: true, maxlength: 120, default: "" },
    startDate: { type: String, trim: true, maxlength: 30, default: "" },
    endDate: { type: String, trim: true, maxlength: 30, default: "" },
    bullets: { type: [bulletSchema], default: [] },
  },
  { _id: false }
);

const achievementSchema = new Schema(
  {
    title: { type: String, trim: true, maxlength: 160, default: "" },
    detail: { type: String, trim: true, maxlength: 250, default: "" },
  },
  { _id: false }
);

const personalSchema = new Schema(
  {
    fullName: { type: String, trim: true, maxlength: 120, default: "" },
    email: { type: String, trim: true, maxlength: 320, default: "" },
    phone: { type: String, trim: true, maxlength: 30, default: "" },
    location: { type: String, trim: true, maxlength: 120, default: "" },
    linkedin: { type: String, trim: true, maxlength: 300, default: "" },
    github: { type: String, trim: true, maxlength: 300, default: "" },
    summary: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { _id: false }
);

const resumeDraftSchema = new Schema(
  {
    ownerEmail: { type: String, required: true, index: true },
    templateId: {
      type: String,
      enum: ["standard_ats", "iiitv_latex_style"],
      default: "standard_ats",
    },
    personal: { type: personalSchema, default: () => ({}) },
    education: { type: [educationSchema], default: [] },
    skills: { type: [String], default: [] },
    projects: { type: [projectSchema], default: [] },
    experience: { type: [experienceSchema], default: [] },
    achievements: { type: [achievementSchema], default: [] },
    version: { type: Number, default: 1 },
    expireAt: {
      type: Date,
      default: () => new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  { timestamps: true }
);

resumeDraftSchema.index({ ownerEmail: 1 }, { unique: true });
resumeDraftSchema.index({ updatedAt: 1 });

export default mongoose.model("ResumeDraft", resumeDraftSchema);
