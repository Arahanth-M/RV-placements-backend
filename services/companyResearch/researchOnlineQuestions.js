import { structureOaPage } from "./structureOaPage.js";
import { consolidateOaItems } from "./consolidateOaItems.js";
import { researchSourcedContent } from "./researchSourcedContent.js";
import { resolveOaPrepRole } from "../../utils/oaPrepRoles.js";
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
 * OA search queries. Role and country are included only when present.
 * @param {{ companyName?: string, role?: string, country?: string }} input
 */
export function buildOnlineAssessmentSearchQueries({ companyName, role, country } = {}) {
  const company = compact(companyName);
  if (!company) {
    throw new ResearchInterviewQuestionsError("OA research failed: companyName is required.", {
      code: "invalid_input",
    });
  }
  const roleText = compact(role);
  const countryText = compact(country);
  const subject = roleText ? `${quoted(company)} ${quoted(roleText)}` : quoted(company);
  const queries = [
    `${subject} online assessment questions`,
    `${subject} OA questions`,
    `${subject} coding test questions`,
  ];
  if (countryText) {
    queries.push(`${subject} online assessment ${countryText}`);
  }
  return queries;
}

function resolveMaxSources(value) {
  if (value == null || value === "") return DEFAULT_MAX_SOURCES;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new ResearchInterviewQuestionsError(
      "OA research failed: maxSources must be a positive integer.",
      { code: "invalid_input" }
    );
  }
  return Math.min(n, MAX_SOURCES_CAP);
}

/**
 * OA-question research. Does not persist links or questions.
 * @param {{ companyName?: string, role?: string, country?: string, maxSources?: number, searchDepth?: "basic" | "advanced" }} input
 */
export async function researchOnlineQuestions(input = {}) {
  const companyName = compact(input.companyName);
  const { label: roleLabel } = resolveOaPrepRole(input.role);
  const role = roleLabel;
  const country = compact(input.country);
  const queries = buildOnlineAssessmentSearchQueries({ companyName, role, country });
  const base = await researchSourcedContent({
    companyName,
    role,
    country,
    queries,
    maxSources: resolveMaxSources(input.maxSources),
    searchDepth: input.searchDepth === "advanced" ? "advanced" : "basic",
    structurePage: structureOaPage,
    textOf: (item) => item?.question,
    failurePrefix: "OA research failed",
    ErrorClass: ResearchInterviewQuestionsError,
  });
  const consolidated = await consolidateOaItems(base.items, { companyName, role });
  return {
    ...base,
    items: consolidated,
    stats: {
      ...base.stats,
      consolidatedCandidates: consolidated.length,
      finalCandidates: consolidated.length,
    },
  };
}
