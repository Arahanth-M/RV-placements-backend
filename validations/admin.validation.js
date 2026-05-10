import Joi from "joi";
import { PPO_BRANCH_CODES_ARRAY } from "../utils/ppoBranchCodes.js";

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

export const adminMustDoTopicUpdateSchema = Joi.object({
  topic: Joi.string().trim().max(500).required(),
}).unknown(true);

export const adminCompanyStatsSchema = Joi.object({
  totalStudentsApplied: nonNegIntField.optional(),
  totalClearedOA: nonNegIntField.optional(),
  totalGotIn: nonNegIntField.optional(),
  ppoConversionGotIn: nonNegIntField.optional(),
  ppoConversionConverted: nonNegIntField.optional(),
  ppoConversionAcceptanceRate: Joi.alternatives()
    .try(Joi.number().min(0), Joi.string().trim().pattern(/^\d+(\.\d+)?$/))
    .optional(),
  ppoConversionType: Joi.string().max(200).allow("").optional(),
  ppoConversionNotApplicable: Joi.boolean().optional(),
  ppoBranchStats: Joi.array()
    .items(
      Joi.object({
        branchCode: Joi.string()
          .trim()
          .lowercase()
          .valid(...PPO_BRANCH_CODES_ARRAY)
          .required(),
        gotIn: nonNegIntField.required(),
        converted: nonNegIntField.required(),
        convertedNotApplicable: Joi.boolean().optional(),
      }).unknown(false)
    )
    .max(PPO_BRANCH_CODES_ARRAY.length)
    .optional(),
  /** Dream / open-dream / off-campus placement got-in by branch (visit row; not PPO conversion). */
  placementGotInBranchStats: Joi.array()
    .items(
      Joi.object({
        branchCode: Joi.string()
          .trim()
          .lowercase()
          .valid(...PPO_BRANCH_CODES_ARRAY)
          .required(),
        gotIn: nonNegIntField.required(),
      }).unknown(false)
    )
    .max(PPO_BRANCH_CODES_ARRAY.length)
    .optional(),
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
  offCampus: Joi.boolean().optional(),
  /** Placement-year visit row (`company_visits`), not static `companies`. */
  date_of_visit: Joi.string().max(120).allow("").optional(),
}).unknown(true);

export const adminMissingCompanyStatusSchema = Joi.object({
  status: Joi.string().valid("PENDING", "ADDED", "REJECTED").required(),
}).unknown(true);

export default {
  adminOaQuestionUpdateSchema,
  adminInterviewQuestionUpdateSchema,
  adminInterviewProcessUpdateSchema,
  adminMustDoTopicUpdateSchema,
  adminCompanyStatsSchema,
  adminCompanyTotalGotInAdjustmentSchema,
  adminCompanyRolesSchema,
  adminCompanyGeneralSchema,
  adminMissingCompanyStatusSchema,
};
