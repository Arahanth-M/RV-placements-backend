import Joi from "joi";

const dateKey = Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/);

const checklistItemSchema = Joi.object({
  id: Joi.string().trim().max(64).optional(),
  text: Joi.string().trim().min(1).max(200).required(),
  done: Joi.boolean().optional(),
}).unknown(false);

const reminderSchema = Joi.object({
  kind: Joi.string()
    .trim()
    .valid("none", "day_of", "day_before", "week_before", "custom")
    .default("none"),
  channel: Joi.string()
    .trim()
    .valid("in_app", "email", "both", "whatsapp", "sms")
    .default("in_app"),
  phone: Joi.string().trim().allow("").max(20).optional(),
  note: Joi.string().trim().allow("").max(400).optional(),
}).unknown(false);

export const driveCalendarCreateSchema = Joi.object({
  type: Joi.string().trim().valid("visit", "deadline", "note").default("visit"),
  title: Joi.string().trim().min(2).max(160).required(),
  companyName: Joi.string().trim().allow("").max(160).optional(),
  notes: Joi.string().trim().allow("").max(2000).optional(),
  dateKey: dateKey.required(),
  timeLabel: Joi.string().trim().allow("").max(64).optional(),
  checklist: Joi.array().items(checklistItemSchema).max(20).optional(),
  reminder: reminderSchema.optional(),
  /** @deprecated ignored — use reminder */
  reminders: Joi.any().optional(),
}).unknown(false);

export const driveCalendarUpdateSchema = Joi.object({
  type: Joi.string().trim().valid("visit", "deadline", "note").optional(),
  title: Joi.string().trim().min(2).max(160).optional(),
  companyName: Joi.string().trim().allow("").max(160).optional(),
  notes: Joi.string().trim().allow("").max(2000).optional(),
  dateKey: dateKey.optional(),
  timeLabel: Joi.string().trim().allow("").max(64).optional(),
  checklist: Joi.array().items(checklistItemSchema).max(20).optional(),
  reminder: reminderSchema.optional(),
  reminders: Joi.any().optional(),
  rescheduleReminders: Joi.boolean().optional(),
}).unknown(false);

export const driveCalendarChecklistToggleSchema = Joi.object({
  itemId: Joi.string().trim().min(1).max(64).required(),
  done: Joi.boolean().optional(),
}).unknown(false);

export default {
  driveCalendarCreateSchema,
  driveCalendarUpdateSchema,
  driveCalendarChecklistToggleSchema,
};
