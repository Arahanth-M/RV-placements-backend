/**
 * Lean /general card coverage counts from company_platform_content.
 * Matches platform detail filtering: approved (or missing status) + non-empty text.
 */

export const EMPTY_PLATFORM_PREP_COVERAGE = Object.freeze({
  oa: 0,
  interview: 0,
  experiences: 0,
});

function isApprovedStatus(status) {
  return !status || status === "approved";
}

export function countApprovedQuestions(items) {
  return (Array.isArray(items) ? items : []).filter(
    (item) => isApprovedStatus(item?.status) && String(item?.question || "").trim() !== ""
  ).length;
}

export function countApprovedExperiences(items) {
  return (Array.isArray(items) ? items : []).filter(
    (item) => isApprovedStatus(item?.status) && String(item?.content || "").trim() !== ""
  ).length;
}

/**
 * @param {Record<string, unknown>|null|undefined} doc
 * @returns {{ oa: number, interview: number, experiences: number }}
 */
export function platformPrepCoverageFromDoc(doc) {
  return {
    oa: countApprovedQuestions(doc?.onlineQuestions),
    interview: countApprovedQuestions(doc?.interviewQuestions),
    experiences:
      countApprovedExperiences(doc?.interviewExperiences) +
      countApprovedExperiences(doc?.internshipExperiences),
  };
}
