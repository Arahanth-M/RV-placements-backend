import { normalizeSolutionText } from "../../utils/normalizeSolutionText.js";

const CODING_SOLUTION_RE =
  /#include|int main\s*\(|std::|vector\s*<|class Solution|cout\s*<<|cin\s*>>|public static void main|def |\bimport java\b/i;

const CODING_QUESTION_RE =
  /\b(leetcode|hackerrank|write a (function|program|code)|implement |time complexity|linked list|binary tree|two pointers|dynamic programming|given an array|return the)\b/i;

export function normalizeQuestionKey(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function extractQuestionText(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        return String(parsed.question || parsed.content || parsed.experience || "").trim() || trimmed;
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  if (typeof raw === "object") {
    return String(raw.question || raw.content || raw.experience || raw.title || "").trim();
  }
  return String(raw).trim();
}

export function looksLikeCoding(question, solution) {
  return CODING_SOLUTION_RE.test(String(solution || "")) || CODING_QUESTION_RE.test(String(question || ""));
}

export function parseExperienceEntry(entry) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const content = String(entry.content || entry.experience || "").trim();
    return {
      content,
      isAnonymous: entry.isAnonymous === true || entry.isAnonymous === "true",
      submittedBy: normalizePerson(entry.submittedBy),
    };
  }
  const trimmed = String(entry || "").trim();
  if (!trimmed) return { content: "", isAnonymous: false, submittedBy: undefined };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const content = String(parsed.content || parsed.experience || "").trim();
      return {
        content: content || trimmed,
        isAnonymous: parsed.isAnonymous === true || parsed.isAnonymous === "true",
        submittedBy: normalizePerson(parsed.submittedBy),
      };
    }
  } catch {
    // plain string
  }
  return { content: trimmed, isAnonymous: false, submittedBy: undefined };
}

function normalizePerson(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const name = String(raw.name || "").trim();
  const email = String(raw.email || "").trim();
  if (!name && !email) return undefined;
  return { name, email };
}

function approvedMeta() {
  return { status: "approved", approvedAt: new Date() };
}

export function pairQuestionsAndSolutions(questions, solutions) {
  const qList = Array.isArray(questions) ? questions : [];
  const sList = Array.isArray(solutions) ? solutions : [];
  return qList.map((q, i) => ({
    question: extractQuestionText(q),
    solution: typeof sList[i] === "string" ? sList[i].trim() : extractQuestionText(sList[i]),
  }));
}

export function toQuestionItems(pairs) {
  const seen = new Set();
  const out = [];
  for (const pair of pairs) {
    const question = String(pair.question || "").trim();
    if (!question) continue;
    const key = normalizeQuestionKey(question);
    if (seen.has(key)) continue;
    seen.add(key);
    const solution = normalizeSolutionText(pair.solution);
    const coding = looksLikeCoding(question, solution);
    const item = {
      kind: coding ? "coding" : "non_coding",
      question,
      intuition: "",
      isAnonymous: false,
      ...approvedMeta(),
    };
    if (coding) {
      item.solutions = { cpp: solution, java: "", python: "" };
      item.answer = "";
    } else {
      item.answer = solution;
    }
    out.push(item);
  }
  return out;
}

export function toExperienceItems(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const parsed = parseExperienceEntry(entry);
    const content = String(parsed.content || "").trim();
    if (!content) continue;
    const key = normalizeQuestionKey(content);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      content,
      isAnonymous: parsed.isAnonymous === true,
      ...(parsed.submittedBy ? { submittedBy: parsed.submittedBy } : {}),
      ...approvedMeta(),
    });
  }
  return out;
}

export function toMustDoItems(topics) {
  const seen = new Set();
  const out = [];
  for (const topicRaw of Array.isArray(topics) ? topics : []) {
    const topic = String(topicRaw || "").trim();
    if (!topic) continue;
    const key = normalizeQuestionKey(topic);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ topic, ...approvedMeta() });
  }
  return out;
}

export function toCodingQuestionItems(rows) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row == null) continue;
    const title =
      typeof row === "string"
        ? row.trim()
        : String(row.title || row.Title || row.question || "").trim();
    const key = normalizeQuestionKey(title || JSON.stringify(row));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const intuition =
      typeof row === "object"
        ? String(row.intuition || row.Intuition || "").replace(/\\n/g, "\n").trim()
        : "";
    out.push({
      question: row,
      solutions: { cpp: "", java: "", python: "" },
      intuition,
      ...approvedMeta(),
    });
  }
  return out;
}

/**
 * @param {Array<Record<string, unknown>>} visits
 * @param {Record<string, unknown>|null} staticRow
 */
export function buildPlatformContentDoc(companyId, visits, staticRow) {
  const onlinePairs = [];
  const interviewPairs = [];
  const interviewExperiences = [];
  const internshipExperiences = [];
  const mustDo = [];
  const mcqQuestions = [];

  for (const visit of visits) {
    onlinePairs.push(
      ...pairQuestionsAndSolutions(visit.onlineQuestions, visit.onlineQuestions_solution)
    );
    interviewPairs.push(
      ...pairQuestionsAndSolutions(visit.interviewQuestions, visit.interviewQuestions_solution)
    );
    interviewExperiences.push(...(Array.isArray(visit.interviewProcess) ? visit.interviewProcess : []));
    internshipExperiences.push(
      ...(Array.isArray(visit.internshipExperience) ? visit.internshipExperience : [])
    );
    mustDo.push(...(Array.isArray(visit.must_do_topics) ? visit.must_do_topics : []));
    if (Array.isArray(visit.mcqQuestions)) mcqQuestions.push(...visit.mcqQuestions);
  }

  if (Array.isArray(staticRow?.must_do_topics)) {
    mustDo.push(...staticRow.must_do_topics);
  }

  return {
    companyId,
    onlineQuestions: toQuestionItems(onlinePairs),
    interviewQuestions: toQuestionItems(interviewPairs),
    interviewExperiences: toExperienceItems(interviewExperiences),
    internshipExperiences: toExperienceItems(internshipExperiences),
    mustDoTopics: toMustDoItems(mustDo),
    codingQuestions: toCodingQuestionItems(staticRow?.prev_coding_ques),
    mcqQuestions,
  };
}
