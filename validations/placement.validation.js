import Joi from "joi";

const stringArray = Joi.array().items(Joi.string().max(50000)).max(500);

export const placementDataSchema = Joi.object({
  onlineQuestions: stringArray.optional(),
  interviewQuestions: stringArray.optional(),
  interviewProcess: stringArray.optional(),
}).unknown(true);

export default {
  placementDataSchema,
};
