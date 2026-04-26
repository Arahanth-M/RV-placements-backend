import Joi from "joi";

const TEMPLATE_IDS = ["standard_ats", "iiitv_latex_style"];

const text = (max) => Joi.string().trim().max(max).allow("");
const requiredText = (min, max) => Joi.string().trim().min(min).max(max).required();

const bulletSchema = Joi.object({
  text: requiredText(1, 250),
}).unknown(false);

const educationSchema = Joi.object({
  institution: text(140),
  degree: text(120),
  field: text(120),
  startDate: text(30),
  endDate: text(30),
  score: text(40),
  location: text(120),
}).unknown(false);

const projectSchema = Joi.object({
  name: text(140),
  techStack: text(180),
  link: text(300),
  startDate: text(30),
  endDate: text(30),
  bullets: Joi.array().items(bulletSchema).max(8).default([]),
}).unknown(false);

const experienceSchema = Joi.object({
  company: text(140),
  role: text(120),
  location: text(120),
  startDate: text(30),
  endDate: text(30),
  bullets: Joi.array().items(bulletSchema).max(8).default([]),
}).unknown(false);

const achievementSchema = Joi.object({
  title: text(160),
  detail: text(250),
}).unknown(false);

const personalSchema = Joi.object({
  fullName: text(120),
  email: text(320),
  phone: text(30),
  location: text(120),
  linkedin: text(300),
  github: text(300),
  summary: text(500),
}).unknown(false);

const resumePayloadSchema = Joi.object({
  templateId: Joi.string()
    .valid(...TEMPLATE_IDS)
    .default("standard_ats"),
  personal: personalSchema.default({}),
  education: Joi.array().items(educationSchema).max(8).default([]),
  skills: Joi.array().items(requiredText(1, 80)).max(40).default([]),
  projects: Joi.array().items(projectSchema).max(12).default([]),
  experience: Joi.array().items(experienceSchema).max(10).default([]),
  achievements: Joi.array().items(achievementSchema).max(15).default([]),
}).unknown(false);

export const resumeDraftSaveSchema = Joi.object({
  version: Joi.number().integer().min(0).required(),
  payload: resumePayloadSchema.required(),
}).unknown(false);

export const resumeExportSchema = Joi.object({
  payload: resumePayloadSchema.required(),
}).unknown(false);

export const allowedResumeTemplates = TEMPLATE_IDS;

