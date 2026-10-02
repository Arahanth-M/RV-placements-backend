import Joi from "joi";

export const practiceChallengeRunSchema = Joi.object({
  code: Joi.string().trim().min(1).max(120000).required(),
  language: Joi.string().trim().valid("python", "cpp", "c++", "java", "py").default("python"),
}).unknown(false);

export const practiceChallengeSubmitSchema = Joi.object({
  code: Joi.string().trim().min(1).max(120000).required(),
  language: Joi.string().trim().valid("python", "cpp", "c++", "java", "py").default("python"),
}).unknown(false);

export default {
  practiceChallengeRunSchema,
  practiceChallengeSubmitSchema,
};
