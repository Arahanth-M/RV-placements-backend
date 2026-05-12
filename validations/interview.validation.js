import Joi from "joi";

const requiredPresent = Joi.custom((value, helpers) => {
  if (value === null || value === undefined || value === "") {
    return helpers.error("any.required");
  }
  return value;
}, "required-present");

export const interviewStartSchema = Joi.object({
  companyId: requiredPresent.required(),
  placementVisitType: Joi.string().allow("").optional(),
  placementCluster: Joi.string().allow("").optional(),
  placementYear: Joi.number().integer().min(2000).max(2100).optional(),
  mergePlacementByType: Joi.boolean().optional(),
  interviewPlanMode: Joi.string().valid("custom").optional(),
  customRounds: Joi.array()
    .min(1)
    .max(4)
    .items(
      Joi.object({
        type: Joi.string()
          .valid("DSA", "System Design", "SQL", "CS Fundamentals", "HR")
          .required(),
        difficulty: Joi.string().valid("easy", "medium", "hard").required(),
      })
    )
    .required(),
}).unknown(true);

export const interviewSubmitAnswerSchema = Joi.object({
  sessionId: Joi.string().trim().min(1).max(128).required(),
  answer: Joi.string().required().max(500000),
  language: Joi.string()
    .trim()
    .valid("python", "py", "cpp", "c++", "cxx", "cplusplus", "java")
    .optional(),
}).unknown(true);

export const interviewMoveRoundSchema = Joi.object({
  sessionId: Joi.string().trim().min(1).max(128).required(),
}).unknown(true);

export const interviewRunPreviewSchema = Joi.object({
  sessionId: Joi.string().trim().min(1).max(128).required(),
  code: Joi.string().required().max(500000),
  language: Joi.string()
    .trim()
    .valid("python", "py", "sql", "cpp", "c++", "cxx", "cplusplus", "java")
    .required(),
}).unknown(true);

export default {
  interviewStartSchema,
  interviewSubmitAnswerSchema,
  interviewMoveRoundSchema,
  interviewRunPreviewSchema,
};
