/**
 * Lean /general card coverage counts from company_platform_content.
 * Matches platform detail filtering: approved (or missing status) + non-empty text.
 */

import { prepRoleLabelForKey } from "./prepRole.js";

export const EMPTY_PLATFORM_PREP_COVERAGE = Object.freeze({
  oa: 0,
  interview: 0,
  experiences: 0,
});

function isApprovedStatus(status) {
  return !status || status === "approved";
}

function isApprovedQuestion(item) {
  return isApprovedStatus(item?.status) && String(item?.question || "").trim() !== "";
}

function isApprovedExperience(item) {
  return isApprovedStatus(item?.status) && String(item?.content || "").trim() !== "";
}

export function countApprovedQuestions(items) {
  return (Array.isArray(items) ? items : []).filter(isApprovedQuestion).length;
}

export function countApprovedExperiences(items) {
  return (Array.isArray(items) ? items : []).filter(isApprovedExperience).length;
}

/**
 * @param {Record<string, unknown>|null|undefined} doc
 * @returns {{ oa: number, interview: number, experiences: number }}
 */
export function platformPrepCoverageFromDoc(doc) {
  return {
    oa:
      countApprovedQuestions(doc?.onlineQuestions) +
      countApprovedQuestions(doc?.mcqQuestions),
    interview: countApprovedQuestions(doc?.interviewQuestions),
    experiences:
      countApprovedExperiences(doc?.interviewExperiences) +
      countApprovedExperiences(doc?.internshipExperiences),
  };
}

function emptyRoleCounts() {
  return { oa: 0, interview: 0, experiences: 0 };
}

/**
 * Per-role OA / interview / experience counts for company cards.
 * Catalog roles are listed even at zero. Untagged rows are "General" and only
 * appear when they have approved content.
 * @param {Record<string, unknown>|null|undefined} doc
 * @returns {{ key: string, label: string, oa: number, interview: number, experiences: number }[]}
 */
export function platformPrepCoverageByRoleFromDoc(doc) {
  const buckets = new Map();
  const add = (key, field) => {
    const roleKey = String(key ?? "").trim();
    if (!buckets.has(roleKey)) buckets.set(roleKey, emptyRoleCounts());
    buckets.get(roleKey)[field] += 1;
  };

  for (const item of Array.isArray(doc?.onlineQuestions) ? doc.onlineQuestions : []) {
    if (!isApprovedQuestion(item)) continue;
    add(item?.prepRoleKey, "oa");
  }
  for (const item of Array.isArray(doc?.mcqQuestions) ? doc.mcqQuestions : []) {
    if (!isApprovedQuestion(item)) continue;
    add(item?.prepRoleKey, "oa");
  }
  for (const item of Array.isArray(doc?.interviewQuestions) ? doc.interviewQuestions : []) {
    if (!isApprovedQuestion(item)) continue;
    add(item?.prepRoleKey, "interview");
  }
  const experiences = [
    ...(Array.isArray(doc?.interviewExperiences) ? doc.interviewExperiences : []),
    ...(Array.isArray(doc?.internshipExperiences) ? doc.internshipExperiences : []),
  ];
  for (const item of experiences) {
    if (!isApprovedExperience(item)) continue;
    add(item?.prepRoleKey, "experiences");
  }

  const catalog = Array.isArray(doc?.prepRoles) ? doc.prepRoles : [];
  const seen = new Set();
  const rows = [];

  const pushRow = (key, label) => {
    const roleKey = String(key ?? "").trim();
    if (seen.has(roleKey)) return;
    seen.add(roleKey);
    const counts = buckets.get(roleKey) || emptyRoleCounts();
    rows.push({
      key: roleKey,
      label: String(label || "").trim() || prepRoleLabelForKey(roleKey, catalog),
      oa: counts.oa,
      interview: counts.interview,
      experiences: counts.experiences,
    });
  };

  for (const row of catalog) {
    const roleKey = String(row?.key ?? "").trim();
    if (!roleKey) {
      const general = buckets.get("") || emptyRoleCounts();
      if (general.oa + general.interview + general.experiences === 0) continue;
    }
    pushRow(roleKey, String(row?.label ?? "").trim() || prepRoleLabelForKey(roleKey, catalog));
  }

  const extras = [...buckets.keys()].filter((key) => !seen.has(key));
  extras.sort((a, b) => {
    if (a === b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    return prepRoleLabelForKey(a, catalog).localeCompare(prepRoleLabelForKey(b, catalog));
  });
  for (const key of extras) {
    pushRow(key, prepRoleLabelForKey(key, catalog));
  }

  return rows;
}
