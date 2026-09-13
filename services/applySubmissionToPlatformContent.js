import CompanyPlatformContent from "../models/CompanyPlatformContent.js";
import { sanitizeSubmissionText } from "./submissionContentSanitize.js";

const CODING_SOLUTION_RE =
  /#include|int main\s*\(|std::|vector\s*<|class Solution|cout\s*<<|cin\s*>>|public static void main|def |\bimport java\b/i;
const CODING_QUESTION_RE =
  /\b(leetcode|hackerrank|write a (function|program|code)|implement |time complexity|linked list|binary tree|two pointers|dynamic programming|given an array|return the)\b/i;

function looksLikeCoding(question, solution) {
  return CODING_SOLUTION_RE.test(String(solution || "")) || CODING_QUESTION_RE.test(String(question || ""));
}

function parseSubmissionContent(mergeSource) {
  try {
    return JSON.parse(mergeSource);
  } catch {
    return { question: mergeSource, solution: "" };
  }
}

function approvedMeta(submission) {
  return {
    status: "approved",
    approvedAt: new Date(),
    isAnonymous: submission?.isAnonymous === true || submission?.isAnonymous === "true",
    submittedBy: {
      name: String(submission?.submittedBy?.name || "").trim(),
      email: String(submission?.submittedBy?.email || "").trim(),
    },
  };
}

async function loadOrCreate(companyId) {
  let doc = await CompanyPlatformContent.findOne({ companyId });
  if (doc) return doc;
  doc = await CompanyPlatformContent.create({
    companyId,
    onlineQuestions: [],
    interviewQuestions: [],
    interviewExperiences: [],
    internshipExperiences: [],
    mustDoTopics: [],
    codingQuestions: [],
    mcqQuestions: [],
  });
  return doc;
}

function questionExists(list, questionText) {
  const key = String(questionText || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return (Array.isArray(list) ? list : []).some(
    (item) =>
      String(item?.question || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim() === key
  );
}

/**
 * Apply an approved /general submission onto company_platform_content.
 * Never writes company_visits_with_rvitm.
 */
export async function applySubmissionToPlatformContent(companyId, submission, mergeSource) {
  const type = String(submission?.type || "");
  const parsed = parseSubmissionContent(mergeSource);
  const doc = await loadOrCreate(companyId);
  const meta = approvedMeta(submission);

  if (type === "onlineQuestions" || type === "interviewQuestions") {
    const field = type === "onlineQuestions" ? "onlineQuestions" : "interviewQuestions";
    let questionText = parsed.question || mergeSource;
    if (questionText && typeof questionText !== "string") questionText = String(questionText);
    const sanitizedQuestion = sanitizeSubmissionText(questionText);
    if (!sanitizedQuestion) return;
    if (questionExists(doc[field], sanitizedQuestion)) return;

    const solutionText = parsed.solution ? sanitizeSubmissionText(parsed.solution) : "";
    const coding = looksLikeCoding(sanitizedQuestion, solutionText);
    const item = {
      kind: coding ? "coding" : "non_coding",
      question: sanitizedQuestion,
      intuition: "",
      ...meta,
    };
    if (coding) {
      item.solutions = { cpp: solutionText, java: "", python: "" };
      item.answer = "";
    } else {
      item.answer = solutionText;
    }
    doc[field].push(item);
    await doc.save();
    return;
  }

  if (type === "interviewProcess") {
    let processText = parsed.question || parsed.content || mergeSource;
    if (processText && typeof processText !== "string") processText = String(processText);
    const sanitized = sanitizeSubmissionText(processText);
    if (!sanitized) return;
    const exists = (doc.interviewExperiences || []).some(
      (item) => String(item?.content || "").trim() === sanitized
    );
    if (exists) return;
    doc.interviewExperiences.push({ content: sanitized, ...meta });
    await doc.save();
    return;
  }

  if (type === "internshipExperience") {
    let experienceText = parsed.experience || parsed.content || mergeSource;
    if (experienceText && typeof experienceText !== "string") {
      experienceText = String(experienceText);
    }
    const sanitized = sanitizeSubmissionText(experienceText);
    if (!sanitized) return;
    const exists = (doc.internshipExperiences || []).some(
      (item) => String(item?.content || "").trim() === sanitized
    );
    if (exists) return;
    doc.internshipExperiences.push({ content: sanitized, ...meta });
    await doc.save();
    return;
  }

  if (type === "mustDoTopics") {
    let topicText =
      parsed.question || parsed.content || parsed.topic || mergeSource;
    if (topicText && typeof topicText !== "string") topicText = String(topicText);
    let sanitized = sanitizeSubmissionText(topicText);
    if (!sanitized) return;
    if (sanitized.length > 200) sanitized = sanitized.substring(0, 200);
    const exists = (doc.mustDoTopics || []).some(
      (item) => String(item?.topic || "").trim() === sanitized
    );
    if (exists) return;
    doc.mustDoTopics.push({ topic: sanitized, ...meta });
    await doc.save();
  }
}
