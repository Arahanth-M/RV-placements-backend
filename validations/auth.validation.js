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

export const collegeEnrollmentInterestSchema = Joi.object({
  collegeName: Joi.string().trim().min(2).max(120).required(),
  email: emailField,
  contactName: Joi.string().trim().allow("").max(120).optional(),
}).unknown(false);

const featureId = Joi.string()
  .trim()
  .lowercase()
  .valid(
    "company_insights",
    "ai_interviews",
    "prep_path",
    "resources_must_do",
    "coding_experiences",
    "practice_challenges",
    "peer_mocks",
    "behavioral_coach",
    "career_explorer",
    "resume_builder",
    "drive_calendar",
    "document_vault",
    "hear_from_seniors",
    "performance_overview"
  );

const dataExtentId = Joi.string()
  .trim()
  .lowercase()
  .valid(
    "historical_placements",
    "company_visits",
    "interview_experiences",
    "coding_questions",
    "eligibility_cutoffs",
    "ongoing_drive_updates"
  );

export const collegeOnboardingRequestSchema = Joi.object({
  path: Joi.string().trim().lowercase().valid("demo", "self_onboard").required(),
  collegeName: Joi.string().trim().min(2).max(160).required(),
  pocName: Joi.string().trim().min(2).max(120).required(),
  pocEmail: emailField,
  pocPhone: Joi.string().trim().allow("").max(40).optional(),
  willProvideData: Joi.boolean().when("path", {
    is: "self_onboard",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  dataExtent: Joi.array().items(dataExtentId).max(12).when("path", {
    is: "self_onboard",
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
  selectedFeatures: Joi.array().items(featureId).min(1).max(20).when("path", {
    is: "self_onboard",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  approxPriceInr: Joi.number().integer().min(0).max(50_000_000).when("path", {
    is: "self_onboard",
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
}).unknown(false);

export default {
  loginSchema,
  googleAuthFallbackSchema,
  blockedLoginInterestSchema,
  collegeEnrollmentInterestSchema,
  collegeOnboardingRequestSchema,
};
