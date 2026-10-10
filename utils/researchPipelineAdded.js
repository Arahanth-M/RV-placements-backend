/**
 * A company is "added" in the platform prep catalog only after the Tavily +
 * Firecrawl research pipeline has published content onto company_platform_content.
 * Student submissions carry submittedBy and do not count. Pipeline publishes
 * set reviewedBy and do not set submittedBy. Saved research links and link
 * summaries count as well, including OA runs that do not store questions yet.
 */

function text(value) {
  return String(value ?? "").trim();
}

function personPresent(person) {
  if (!person || typeof person !== "object") return false;
  return Boolean(text(person.name) || text(person.email));
}

function approvedField(item, field) {
  if (!item || typeof item !== "object") return false;
  if (item.status && item.status !== "approved") return false;
  return text(item[field]) !== "";
}

/** Pipeline publish writes reviewedBy and leaves submittedBy empty. */
function publishedByResearchPipeline(item, field) {
  if (!approvedField(item, field)) return false;
  if (personPresent(item.submittedBy)) return false;
  return personPresent(item.reviewedBy);
}

function anyPipelineItem(items, field) {
  return (Array.isArray(items) ? items : []).some((item) =>
    publishedByResearchPipeline(item, field)
  );
}

/**
 * @param {Record<string, unknown>|null|undefined} doc
 * @returns {boolean}
 */
export function companyHasResearchPipelineContent(doc) {
  const sources = Array.isArray(doc?.researchSources) ? doc.researchSources : [];
  if (sources.some((source) => text(source?.url))) return true;

  const summaries = Array.isArray(doc?.researchLinksSummaries) ? doc.researchLinksSummaries : [];
  if (summaries.some((row) => text(row?.summary))) return true;

  if (anyPipelineItem(doc?.onlineQuestions, "question")) return true;
  if (anyPipelineItem(doc?.interviewQuestions, "question")) return true;
  if (anyPipelineItem(doc?.mcqQuestions, "question")) return true;
  if (anyPipelineItem(doc?.interviewExperiences, "content")) return true;
  if (anyPipelineItem(doc?.internshipExperiences, "content")) return true;
  return false;
}
