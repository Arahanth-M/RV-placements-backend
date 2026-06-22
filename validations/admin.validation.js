import Joi from "joi";
import { COMPANY_VISIT_CLUSTER_CANONICAL } from "../utils/companyVisitClusterCanonical.js";
import { PLACEMENT_HUB_CLUSTER_KEYS } from "../utils/placementCluster.js";
import { PLACEMENT_OPEN_DREAM_SETTING_YEARS } from "../utils/placementYears.js";
import {
  PPO_BRANCH_CODES,
  PPO_BRANCH_CODES_ARRAY,
  PPO_BRANCH_LEGACY_ALIASES,
  normalizePpoBranchCode,
} from "../utils/ppoBranchCodes.js";

const acceptedBranchInputCodes = [
  ...PPO_BRANCH_CODES_ARRAY,
  ...Object.keys(PPO_BRANCH_LEGACY_ALIASES),
];

const branchCodeField = Joi.string()
  .trim()
  .lowercase()
  .valid(...acceptedBranchInputCodes)
  .custom((value, helpers) => {
    const normalized = normalizePpoBranchCode(value);
    if (!PPO_BRANCH_CODES.has(normalized)) {
      return helpers.error("any.invalid");
    }
    return normalized;
  });

const openDreamMinLpaField = Joi.number().min(0).max(200);

const openDreamClusterMapSchema = Joi.object(
  Object.fromEntries(
    PLACEMENT_HUB_CLUSTER_KEYS.map((key) => [key, openDreamMinLpaField.optional()])
  )
).min(1);

export const adminPlacementHubSettingsSchema = Joi.object({
  openDreamMinLpaByYear: Joi.object(
    Object.fromEntries(
      PLACEMENT_OPEN_DREAM_SETTING_YEARS.map((year) => [
        String(year),
        openDreamClusterMapSchema.optional(),
      ])
    )
  )
    .min(1)
    .required(),
}).required();

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
        branchCode: branchCodeField.required(),
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
        branchCode: branchCodeField.required(),
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
  /** Hub routing; empty clears to default CSE slot (legacy). */
  cluster: Joi.string()
    .valid(...COMPANY_VISIT_CLUSTER_CANONICAL)
    .allow("")
    .optional(),
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
};
