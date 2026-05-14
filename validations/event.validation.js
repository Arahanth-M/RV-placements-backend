import Joi from "joi";

const dateField = Joi.alternatives().try(
  Joi.string().trim().max(200),
  Joi.date(),
  Joi.number()
);

export const eventCreateSchema = Joi.object({
  type: Joi.string().trim().max(80).optional().allow(""),
  organizer: Joi.string().trim().max(120).optional().allow(""),
  title: Joi.string().trim().min(1).max(500).required(),
  url: Joi.string().trim().min(1).max(2048).required(),
  lastDateToRegister: dateField.required(),
}).unknown(true);

export const eventUpdateSchema = Joi.object({
  type: Joi.string().trim().max(80).optional().allow(""),
  organizer: Joi.string().trim().max(120).optional().allow(""),
  title: Joi.string().trim().min(1).max(500).optional(),
  url: Joi.string().trim().min(1).max(2048).optional(),
  lastDateToRegister: dateField.optional(),
}).unknown(true);

export default {
  eventCreateSchema,
  eventUpdateSchema,
};
