import Joi from "joi";
import { COMPANY_DETAIL_VISIT_YEARS } from "../utils/placementYears.js";
import { PPO_BRANCH_CODES_ARRAY } from "../utils/ppoBranchCodes.js";

const stringArray = Joi.array().items(Joi.string().max(50000)).max(500);

export const placementDataSchema = Joi.object({
  onlineQuestions: stringArray.optional(),
  interviewQuestions: stringArray.optional(),
  interviewProcess: stringArray.optional(),
}).unknown(true);

const objectIdPattern = /^[a-fA-F0-9]{24}$/;

/** Must match SPC placement form and backend `resolveApprovedVisitForSpcPlacementOffer` matching rules. */
export const SPC_SUBMIT_TYPE_OF_OFFER_VALUES = Object.freeze([
  "Internship(PPO)",
  "FTE",
  "Internship+FTE",
  "Internship + FTE (PBC)",
  "Only internship(6 months)",
]);

export const spcConversionDetailsSchema = Joi.object({
  companyId: Joi.string().trim().pattern(objectIdPattern).required(),
  placementYear: Joi.number()
    .integer()
    .valid(...COMPANY_DETAIL_VISIT_YEARS)
    .required(),
  branchCode: Joi.string()
    .trim()
    .lowercase()
    .valid(...PPO_BRANCH_CODES_ARRAY)
    .required(),
  email: Joi.string().trim().email().required(),
  name: Joi.string().trim().min(1).required(),
  usn: Joi.string().trim().min(1).required(),
  conversionType: Joi.string().valid("fte", "fte_internship").required(),
  ctc: Joi.string().trim().allow("").optional(),
  base: Joi.string().trim().allow("").optional(),
  role: Joi.string().trim().max(200).allow("").optional(),
  stipend: Joi.when("conversionType", {
    is: "fte_internship",
    then: Joi.string().trim().allow("").optional(),
    otherwise: Joi.string().trim().allow("").optional(),
  }),
  /** Same hub hint as GET `/companies/:id?placementContext=` when multiple approved visits share a year. */
  placementContext: Joi.string().trim().max(80).allow("").optional(),
  placementListContext: Joi.string().trim().max(80).allow("").optional(),
}).unknown(false);

export const spcCompanySuggestQuerySchema = Joi.object({
  q: Joi.string().trim().min(2).required(),
  limit: Joi.number().integer().min(1).max(20).optional(),
}).unknown(false);

/** SPC "Add placement data" — optional `companyId` + `placementYear` + `branchCode` to bump visit got-in counts. */
export const spcSubmitPlacementSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  name: Joi.string().trim().min(1).required(),
  usn: Joi.string().trim().min(1).required(),
  companyPlaced: Joi.string().trim().min(1).required(),
  typeOfOffer: Joi.string()
    .trim()
    .valid(...SPC_SUBMIT_TYPE_OF_OFFER_VALUES)
    .required(),
  stipend: Joi.string().trim().allow("").optional(),
  base: Joi.string().trim().allow("").optional(),
  ctc: Joi.string().trim().allow("").optional(),
  role: Joi.string().trim().max(200).allow("").optional(),
  companyId: Joi.string().trim().pattern(objectIdPattern).allow("", null).optional(),
  placementYear: Joi.number()
    .integer()
    .valid(...COMPANY_DETAIL_VISIT_YEARS)
    .optional(),
  branchCode: Joi.string()
    .trim()
    .lowercase()
    .valid(...PPO_BRANCH_CODES_ARRAY, "")
    .optional(),
  placementContext: Joi.string().trim().max(80).allow("").optional(),
  placementListContext: Joi.string().trim().max(80).allow("").optional(),
}).unknown(false);

export default {
  placementDataSchema,
  spcConversionDetailsSchema,
  spcCompanySuggestQuerySchema,
  spcSubmitPlacementSchema,
};
