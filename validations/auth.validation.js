import Joi from "joi";

const emailField = Joi.string()
  .trim()
  .lowercase()
  .email()
  .max(320)
  .required();

export const loginSchema = Joi.object({
  email: emailField,
  password: Joi.string().trim().min(1).max(256).required(),
}).unknown(false);

export const googleAuthFallbackSchema = Joi.object({
  email: emailField,
}).unknown(false);

export const blockedLoginInterestSchema = Joi.object({
  token: Joi.string().trim().min(20).max(2000).required(),
  collegeName: Joi.string().trim().min(2).max(120).required(),
  wantsPlatformAtCollege: Joi.boolean().optional(),
}).unknown(false);

export default {
  loginSchema,
  googleAuthFallbackSchema,
  blockedLoginInterestSchema,
};
