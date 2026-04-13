import Joi from "joi";

const skillItem = Joi.string().trim().max(80).min(1);

export const profileUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120),
  bio: Joi.string().trim().max(500).allow(""),
  skills: Joi.array().items(skillItem).max(40).unique(),
})
  .or("name", "bio", "skills")
  .unknown(false);

export const profileCacheInvalidateSchema = Joi.object({
  email: Joi.string().trim().max(320).optional(),
  emails: Joi.array().items(Joi.string().trim().max(320)).max(5000).optional(),
}).unknown(true);

export default {
  profileUpdateSchema,
  profileCacheInvalidateSchema,
};

