import Joi from "joi";

const t = (max) => Joi.string().trim().max(max);

const roleItemSchema = Joi.object({
  roleName: t(120).min(2).required(),
  ctc: Joi.object().pattern(Joi.string(), Joi.alternatives().try(Joi.number(), Joi.string())).default({}),
  internshipStipend: Joi.number().min(0),
}).unknown(false);

const jobDescriptionItemSchema = Joi.object({
  title: t(300).min(1).required(),
  fileUrl: t(2048).min(1).required(),
  fileType: Joi.string().valid("pdf", "doc", "docx").required(),
}).unknown(false);

const mcqItemSchema = Joi.object({
  question: t(500),
  optionA: t(200),
  optionB: t(200),
  optionC: t(200),
  optionD: t(200),
  answer: t(200),
}).unknown(false);

const selectedCandidateSchema = Joi.object({
  name: t(100).min(2).required(),
  emailId: t(320).email().required(),
}).unknown(false);

const submittedBySchema = Joi.object({
  name: t(120),
  email: t(320).email(),
}).unknown(false);

const optionalCompanyBody = {
  business_model: t(500).allow(""),
  eligibility: t(4000).allow(""),
  offCampus: Joi.boolean(),
  roles: Joi.array().items(roleItemSchema).max(80),
  jobDescription: Joi.array().items(jobDescriptionItemSchema).max(30),
  onlineQuestions: Joi.array().items(t(5000)).max(120),
  onlineQuestions_solution: Joi.array().items(t(5000)).max(120),
  prev_coding_ques: Joi.array().max(80),
  mcqQuestions: Joi.array().items(mcqItemSchema).max(120),
  interviewQuestions: Joi.array().items(t(5000)).max(120),
  interviewQuestions_solution: Joi.array().items(t(5000)).max(120),
  interviewProcess: Joi.array().items(t(5000)).max(80),
  internshipExperience: Joi.array().items(t(8000)).max(80),
  count: Joi.alternatives().try(t(64), Joi.number()),
  selectedCandidates: Joi.array().items(selectedCandidateSchema).max(500),
  Must_Do_Topics: Joi.array().items(t(500)).max(120),
  date_of_visit: t(120),
  status: Joi.string().valid("pending", "approved", "rejected"),
  submittedBy: submittedBySchema,
  logo: t(2048),
  domain: t(255),
  cluster: Joi.string().valid(
    "Computer Science and Engineering",
    "Electronics and Communication",
    "Mechanical Engineering"
  ),
  helpfulCount: Joi.number().integer().min(0),
  helpfulUsers: Joi.array().items(t(320)).max(10000),
  totalStudentsApplied: Joi.number().integer().min(0),
  totalClearedOA: Joi.number().integer().min(0),
  totalGotIn: Joi.number().integer().min(0),
  ppoConversionGotIn: Joi.number().integer().min(0),
  ppoConversionConverted: Joi.number().integer().min(0),
  ppoConversionAcceptanceRate: Joi.number().min(0),
  ppoConversionType: t(200).allow(""),
  ppoBranchStats: Joi.array()
    .items(
      Joi.object({
        branchCode: Joi.string()
          .trim()
          .lowercase()
          .valid("cd", "cy", "ise", "cse", "aiml", "bt")
          .required(),
        gotIn: Joi.number().integer().min(0).required(),
        converted: Joi.number().integer().min(0).required(),
      }).unknown(false)
    )
    .max(6),
};

export const companyCreateSchema = Joi.object({
  name: t(120).min(2).required(),
  type: t(120).min(1).required(),
  ...optionalCompanyBody,
}).unknown(true);

export const companyUpdateSchema = Joi.object({
  name: t(120).min(2),
  type: t(120).min(1),
  ...optionalCompanyBody,
})
  .unknown(true)
  .custom((value, helpers) => {
    if (value && typeof value === "object" && Object.keys(value).length > 0) {
      return value;
    }
    return helpers.error("any.invalid");
  })
  .messages({
    "any.invalid": "At least one field is required for update",
  });

export default {
  companyCreateSchema,
  companyUpdateSchema,
};
