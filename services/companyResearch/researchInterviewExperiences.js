import { structureInterviewExperiences } from "./structureInterviewExperiences.js";
import { researchSourcedContent } from "./researchSourcedContent.js";
import {
  DEFAULT_MAX_SOURCES,
  MAX_SOURCES_CAP,
  ResearchInterviewQuestionsError,
} from "./researchInterviewQuestions.js";

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function quoted(value) {
  return `"${compact(value).replace(/"/g, "")}"`;
}

/**
 * Interview-experience search queries. Role and country are included only when present.
 * @param {{ companyName?: string, role?: string, country?: string }} input
 */
export function buildInterviewExperienceSearchQueries({ companyName, role, country } = {}) {
  const company = compact(companyName);
  if (!company) {
    throw new ResearchInterviewQuestionsError(
      "Interview experience research failed: companyName is required.",
      { code: "invalid_input" }
    );
  }
  const roleText = compact(role);
  const countryText = compact(country);
  const subject = roleText ? `${quoted(company)} ${quoted(roleText)}` : quoted(company);
  const queries = [
    `${subject} interview experience`,
    `${subject} interview process`,
    `${subject} interview experience rounds`,
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
      "Interview experience research failed: maxSources must be a positive integer.",
      { code: "invalid_input" }
    );
  }
  return Math.min(n, MAX_SOURCES_CAP);
}

/**
 * Interview-experience research. Does not persist anything.
 * @param {{ companyName?: string, role?: string, country?: string, maxSources?: number, searchDepth?: "basic" | "advanced" }} input
 */
export async function researchInterviewExperiences(input = {}) {
  const companyName = compact(input.companyName);
  const role = compact(input.role);
  const country = compact(input.country);
  const queries = buildInterviewExperienceSearchQueries({ companyName, role, country });
  return researchSourcedContent({
    companyName,
    role,
    country,
    queries,
    maxSources: resolveMaxSources(input.maxSources),
    searchDepth: input.searchDepth === "advanced" ? "advanced" : "basic",
    structurePage: structureInterviewExperiences,
    textOf: (item) => item?.content,
    failurePrefix: "Interview experience research failed",
    ErrorClass: ResearchInterviewQuestionsError,
  });
}
