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

export default {
  loginSchema,
  googleAuthFallbackSchema,
};
