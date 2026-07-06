import Joi from "joi";

/** Presence-only: invalid IDs/types still reach Mongoose (same status codes as before). */
const requiredPresent = Joi.custom((value, helpers) => {
  if (value === null || value === undefined || value === "") {
    return helpers.error("any.required");
  }
  return value;
}, "required-present");

export const submissionInputSchema = Joi.object({
  companyId: requiredPresent.required(),
  type: Joi.string().trim().min(1).max(80).required(),
  // No trim: parity with prior `if (!content)` (whitespace-only still accepted)
  content: Joi.string().min(1).max(70000).required(),
  placementYear: Joi.number().integer().valid(2026, 2027, 2028).optional(),
  placementListContext: Joi.string()
    .valid("dream", "open_dream", "summer_internship","internship_only", "off_campus")
    .optional(),
  companyVisitId: Joi.string()
    .trim()
    .pattern(/^[a-fA-F0-9]{24}$/)
    .optional(),
  isAnonymous: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid("true", "false"))
    .optional(),
}).unknown(true);

export const submissionUpdateSchema = Joi.object({
  content: Joi.string().min(1).max(70000).required(),
  isAnonymous: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid("true", "false"))
    .optional(),
}).unknown(true);

export default {
  submissionInputSchema,
  submissionUpdateSchema,
};
