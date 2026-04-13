import Joi from "joi";

const requiredPresent = Joi.custom((value, helpers) => {
  if (value === null || value === undefined || value === "") {
    return helpers.error("any.required");
  }
  return value;
}, "required-present");

export const interviewStartSchema = Joi.object({
  companyId: requiredPresent.required(),
}).unknown(true);

export const interviewSubmitAnswerSchema = Joi.object({
  sessionId: Joi.string().trim().min(1).max(128).required(),
  answer: Joi.string().required().max(500000),
}).unknown(true);

export const interviewMoveRoundSchema = Joi.object({
  sessionId: Joi.string().trim().min(1).max(128).required(),
}).unknown(true);

export default {
  interviewStartSchema,
  interviewSubmitAnswerSchema,
  interviewMoveRoundSchema,
};
