import Joi from "joi";
import { COMPANY_DETAIL_VISIT_YEARS } from "../utils/placementYears.js";
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

const stringArray = Joi.array().items(Joi.string().max(50000)).max(500);

export const placementDataSchema = Joi.object({
  onlineQuestions: stringArray.optional(),
  interviewQuestions: stringArray.optional(),
  interviewProcess: stringArray.optional(),
}).unknown(true);

const objectIdPattern = /^[a-fA-F0-9]{24}$/;

/** Same rules as frontend `compensationVisibilityForTypeOfOffer`. */
function placementCompensationVisibility(typeOfOffer) {
  const t = String(typeOfOffer || "").trim();
  if (t === "FTE") return { stipend: false, fte: true };
  if (t === "Internship(PPO)" || t === "Only internship(6 months)") {
    return { stipend: true, fte: false };
  }
  if (t === "Internship+FTE" || t === "Internship + FTE (PBC)") {
    return { stipend: true, fte: true };
  }
  return { stipend: true, fte: true };
}

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
  branchCode: branchCodeField.required(),
  email: Joi.string().trim().email().required(),
  name: Joi.string().trim().min(1).required(),
  usn: Joi.string().trim().min(1).required(),
  conversionType: Joi.string().valid("fte", "fte_internship").required(),
  ctc: Joi.string().trim().min(1).required(),
  base: Joi.string().trim().min(1).required(),
  role: Joi.string().trim().min(1).max(200).required(),
  stipend: Joi.when("conversionType", {
    is: "fte_internship",
    then: Joi.string().trim().min(1).required(),
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

export const spcCompanyRolesQuerySchema = Joi.object({
  companyId: Joi.string().trim().pattern(objectIdPattern).required(),
  placementYear: Joi.number()
    .integer()
    .valid(...COMPANY_DETAIL_VISIT_YEARS)
    .required(),
  placementContext: Joi.string().trim().max(80).allow("").optional(),
  branchCode: branchCodeField.optional().allow(""),
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
  role: Joi.string().trim().min(1).max(200).required(),
  companyId: Joi.string().trim().pattern(objectIdPattern).required(),
  placementYear: Joi.number()
    .integer()
    .valid(...COMPANY_DETAIL_VISIT_YEARS)
    .required(),
  branchCode: branchCodeField.required(),
  placementContext: Joi.string().trim().max(80).allow("").optional(),
  placementListContext: Joi.string().trim().max(80).allow("").optional(),
})
  .unknown(false)
  .custom((body, helpers) => {
    const comp = placementCompensationVisibility(body.typeOfOffer);
    if (comp.stipend && !String(body.stipend ?? "").trim()) {
      return helpers.error("any.custom", {
        message: "Stipend is required for this type of offer (use TBD if unknown).",
      });
    }
    if (comp.fte && !String(body.ctc ?? "").trim()) {
      return helpers.error("any.custom", {
        message: "CTC is required for this type of offer (use TBD if unknown).",
      });
    }
    if (comp.fte && !String(body.base ?? "").trim()) {
      return helpers.error("any.custom", {
        message: "Base is required for this type of offer (use TBD if unknown).",
      });
    }
    return body;
  });

export const spcUpdatePlacementSchema = Joi.object({
  studentName: Joi.string().trim().min(1).optional(),
  studentEmail: Joi.string().trim().email().optional(),
  studentUsn: Joi.string().trim().min(1).optional(),
  companyPlaced: Joi.string().trim().min(1).optional(),
  typeOfOffer: Joi.string()
    .trim()
    .valid(...SPC_SUBMIT_TYPE_OF_OFFER_VALUES)
    .optional(),
  placementYear: Joi.number()
    .integer()
    .valid(...COMPANY_DETAIL_VISIT_YEARS)
    .allow(null)
    .optional(),
  branchCode: branchCodeField.optional().allow(""),
  role: Joi.string().trim().max(200).allow("").optional(),
  stipend: Joi.string().trim().allow("").optional(),
  base: Joi.string().trim().allow("").optional(),
  ctc: Joi.string().trim().allow("").optional(),
  ppoConversionType: Joi.string()
    .trim()
    .valid("", "FTE", "Internship+FTE")
    .optional(),
  sixMonthsInternshipStipend: Joi.string().trim().allow("").optional(),
}).min(1).unknown(false);

export default {
  placementDataSchema,
  spcConversionDetailsSchema,
  spcCompanySuggestQuerySchema,
  spcCompanyRolesQuerySchema,
  spcSubmitPlacementSchema,
  spcUpdatePlacementSchema,
};
