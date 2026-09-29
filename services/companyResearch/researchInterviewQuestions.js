import { structureInterviewQuestions } from "./structureWithGroq.js";
import { normalizeQuestionKey, researchSourcedContent } from "./researchSourcedContent.js";

export { normalizeQuestionKey };

export const DEFAULT_MAX_SOURCES = 3;
export const MAX_SOURCES_CAP = 8;

export class ResearchInterviewQuestionsError extends Error {
  /**
   * @param {string} message
   * @param {{ code: "invalid_input" | "search_failed" }} details
   */
  constructor(message, details) {
    super(message);
    this.name = "ResearchInterviewQuestionsError";
    this.code = details.code;
  }
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function quoted(value) {
  return `"${compact(value).replace(/"/g, "")}"`;
}

/**
 * Small fixed query list. Role and country are included only when present.
 * @param {{ companyName?: string, role?: string, country?: string }} input
 */
export function buildInterviewSearchQueries({ companyName, role, country } = {}) {
  const company = compact(companyName);
  if (!company) {
    throw new ResearchInterviewQuestionsError(
      "Interview research failed: companyName is required.",
      { code: "invalid_input" }
    );
  }
  const roleText = compact(role);
  const countryText = compact(country);
  const subject = roleText ? `${quoted(company)} ${quoted(roleText)}` : quoted(company);
  const queries = [
    `${subject} interview experience questions`,
    `${subject} interview questions`,
    `${subject} technical interview experience`,
  ];
  if (countryText) {
    queries.push(`${subject} interview experience ${countryText}`);
  }
  return queries;
}

function resolveMaxSources(value) {
  if (value == null || value === "") return DEFAULT_MAX_SOURCES;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new ResearchInterviewQuestionsError(
      "Interview research failed: maxSources must be a positive integer.",
      { code: "invalid_input" }
    );
  }
  return Math.min(n, MAX_SOURCES_CAP);
}

function resolveSearchDepth(value) {
  return value === "advanced" ? "advanced" : "basic";
}

/**
 * Interview-question research. Does not persist anything.
 * @param {{ companyName?: string, role?: string, country?: string, maxSources?: number, searchDepth?: "basic" | "advanced" }} input
 */
export async function researchInterviewQuestions(input = {}) {
  const companyName = compact(input.companyName);
  const role = compact(input.role);
  const country = compact(input.country);
  const queries = buildInterviewSearchQueries({ companyName, role, country });
  const maxSources = resolveMaxSources(input.maxSources);
  const searchDepth = resolveSearchDepth(input.searchDepth);

  return researchSourcedContent({
    companyName,
    role,
    country,
    queries,
    maxSources,
    searchDepth,
    structurePage: structureInterviewQuestions,
    textOf: (item) => item?.question,
    failurePrefix: "Interview research failed",
    ErrorClass: ResearchInterviewQuestionsError,
  });
}
