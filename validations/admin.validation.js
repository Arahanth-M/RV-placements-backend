import Joi from "joi";

const textBlock = Joi.string().max(50000);

const nonNegIntField = Joi.alternatives().try(
  Joi.number().integer().min(0),
  Joi.string().trim().pattern(/^\d+$/)
);

export const adminOaQuestionUpdateSchema = Joi.object({
  question: textBlock.allow("").optional(),
  solution: textBlock.allow("").optional(),
}).unknown(true);

export const adminInterviewQuestionUpdateSchema = Joi.object({
  question: textBlock.allow("").optional(),
  solution: textBlock.allow("").optional(),
}).unknown(true);

export const adminInterviewProcessUpdateSchema = Joi.object({
  content: Joi.string().max(50000).required(),
}).unknown(true);

export const adminCompanyStatsSchema = Joi.object({
  totalStudentsApplied: nonNegIntField.optional(),
  totalClearedOA: nonNegIntField.optional(),
  totalGotIn: nonNegIntField.optional(),
}).unknown(true);

export const adminCompanyTotalGotInAdjustmentSchema = Joi.object({
  delta: Joi.number().integer().valid(-1, 1).required(),
}).unknown(true);

export const adminCompanyRolesSchema = Joi.object({
  roles: Joi.array().items(Joi.object().unknown(true)).required(),
}).unknown(true);

export const adminCompanyGeneralSchema = Joi.object({
  eligibility: Joi.string().max(8000).allow("").optional(),
  business_model: Joi.string().max(500).allow("").optional(),
  type: Joi.string().max(200).allow("").optional(),
}).unknown(true);

export default {
  adminOaQuestionUpdateSchema,
  adminInterviewQuestionUpdateSchema,
  adminInterviewProcessUpdateSchema,
  adminCompanyStatsSchema,
  adminCompanyTotalGotInAdjustmentSchema,
  adminCompanyRolesSchema,
  adminCompanyGeneralSchema,
};
