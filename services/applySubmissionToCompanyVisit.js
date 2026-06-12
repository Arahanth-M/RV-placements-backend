import CompanyVisit from "../models/CompanyVisit.js";
import { invalidateCompanyDetailCache } from "./companyDetailCache.js";
import { sanitizeSubmissionText } from "./submissionContentSanitize.js";

function parseSubmissionContent(mergeSource) {
  try {
    return JSON.parse(mergeSource);
  } catch {
    return { question: mergeSource, solution: "" };
  }
}

function ensureParallelSolutionArray(questions, solutions) {
  const q = Array.isArray(questions) ? [...questions] : [];
  const s = Array.isArray(solutions) ? [...solutions] : [];
  while (s.length < q.length) s.push("");
  return { questions: q, solutions: s };
}

function applyQuestionPairMutation({
  questions,
  solutions,
  questionText,
  solutionText,
}) {
  const sanitizedQuestion = sanitizeSubmissionText(questionText);
  if (!sanitizedQuestion) {
    return { questions, solutions, changed: false };
  }

  const { questions: q, solutions: s } = ensureParallelSolutionArray(questions, solutions);
  const sanitizedSolution = solutionText ? sanitizeSubmissionText(solutionText) : "";
  const existingIndex = q.findIndex(
    (item) => typeof item === "string" && item.trim() === sanitizedQuestion.trim()
  );

  if (existingIndex === -1) {
    q.push(sanitizedQuestion);
    s.push(sanitizedSolution || "");
    return { questions: q, solutions: s, changed: true };
  }

  if (sanitizedSolution) {
    const existingSolution = s[existingIndex] || "";
    s[existingIndex] = existingSolution
      ? `${existingSolution}\n\n${sanitizedSolution}`
      : sanitizedSolution;
    return { questions: q, solutions: s, changed: true };
  }

  if (!s[existingIndex] || typeof s[existingIndex] !== "string") {
    s[existingIndex] = "";
    return { questions: q, solutions: s, changed: true };
  }

  return { questions: q, solutions: s, changed: false };
}

function jsonEntryExistsInStringArray(array, content, contentKeys = ["content"]) {
  const target = String(content || "").trim();
  if (!target) return false;
  return (Array.isArray(array) ? array : []).some((entry) => {
    try {
      const parsed = JSON.parse(entry);
      if (parsed && typeof parsed === "object") {
        for (const key of contentKeys) {
          if (String(parsed[key] || "").trim() === target) return true;
        }
      }
    } catch {
      // legacy plain string
    }
    return String(entry || "").trim() === target;
  });
}

function buildSubmitterJsonEntry(submission, content) {
  return JSON.stringify({
    content,
    submittedBy: {
      name: submission.submittedBy?.name,
      email: submission.submittedBy?.email,
    },
    isAnonymous: submission.isAnonymous === true || submission.isAnonymous === "true",
  });
}

/**
 * Apply one approved submission to a company visit (targeted field updates only).
 * Caller must hold the per-visit approval lock.
 * @param {import("mongoose").Types.ObjectId|string} visitId
 * @param {import("mongoose").Types.ObjectId|string} companyId
 * @param {Record<string, unknown>} submission
 * @param {string} mergeSource
 */
export async function applySubmissionToCompanyVisit(visitId, companyId, submission, mergeSource) {
  const type = String(submission?.type || "");
  const parsedContent = parseSubmissionContent(mergeSource);

  if (type === "onlineQuestions" || type === "interviewQuestions") {
    const questionField = type === "onlineQuestions" ? "onlineQuestions" : "interviewQuestions";
    const solutionField =
      type === "onlineQuestions" ? "onlineQuestions_solution" : "interviewQuestions_solution";

    const visit = await CompanyVisit.findById(visitId)
      .select(`${questionField} ${solutionField}`)
      .lean();
    if (!visit) {
      throw new Error("Company visit not found.");
    }

    let questionText = parsedContent.question || mergeSource;
    if (questionText && typeof questionText !== "string") {
      questionText = String(questionText);
    }
    const solutionText = parsedContent.solution || "";

    const result = applyQuestionPairMutation({
      questions: visit[questionField],
      solutions: visit[solutionField],
      questionText,
      solutionText,
    });

    if (!result.changed) return;

    await CompanyVisit.updateOne(
      { _id: visitId },
      {
        $set: {
          [questionField]: result.questions,
          [solutionField]: result.solutions,
          migratedAt: new Date(),
        },
      }
    );
    await invalidateCompanyDetailCache(companyId);
    return;
  }

  if (type === "interviewProcess") {
    let processText = parsedContent.question || parsedContent.content || mergeSource;
    if (processText && typeof processText !== "string") {
      processText = String(processText);
    }
    const sanitizedProcess = sanitizeSubmissionText(processText);
    if (!sanitizedProcess) return;

    const visit = await CompanyVisit.findById(visitId).select("interviewProcess").lean();
    if (!visit) throw new Error("Company visit not found.");

    const current = Array.isArray(visit.interviewProcess) ? visit.interviewProcess : [];
    if (jsonEntryExistsInStringArray(current, sanitizedProcess)) return;

    await CompanyVisit.updateOne(
      { _id: visitId },
      {
        $push: { interviewProcess: buildSubmitterJsonEntry(submission, sanitizedProcess) },
        $set: { migratedAt: new Date() },
      }
    );
    await invalidateCompanyDetailCache(companyId);
    return;
  }

  if (type === "internshipExperience") {
    let experienceText = parsedContent.experience || parsedContent.content || mergeSource;
    if (experienceText && typeof experienceText !== "string") {
      experienceText = String(experienceText);
    }
    const sanitizedExperience = sanitizeSubmissionText(experienceText);
    if (!sanitizedExperience) return;

    const visit = await CompanyVisit.findById(visitId).select("internshipExperience").lean();
    if (!visit) throw new Error("Company visit not found.");

    const current = Array.isArray(visit.internshipExperience) ? visit.internshipExperience : [];
    if (
      jsonEntryExistsInStringArray(current, sanitizedExperience, ["content", "experience"])
    ) {
      return;
    }

    await CompanyVisit.updateOne(
      { _id: visitId },
      {
        $push: { internshipExperience: buildSubmitterJsonEntry(submission, sanitizedExperience) },
        $set: { migratedAt: new Date() },
      }
    );
    await invalidateCompanyDetailCache(companyId);
    return;
  }

  if (type === "mustDoTopics") {
    let topicText =
      parsedContent.question || parsedContent.content || parsedContent.topic || mergeSource;
    if (topicText && typeof topicText !== "string") {
      topicText = String(topicText);
    }
    let sanitizedTopic = sanitizeSubmissionText(topicText);
    if (!sanitizedTopic) return;
    if (sanitizedTopic.length > 200) {
      sanitizedTopic = sanitizedTopic.substring(0, 200);
    }

    const visit = await CompanyVisit.findById(visitId).select("must_do_topics").lean();
    if (!visit) throw new Error("Company visit not found.");

    const current = Array.isArray(visit.must_do_topics) ? visit.must_do_topics : [];
    if (current.includes(sanitizedTopic)) return;

    await CompanyVisit.updateOne(
      { _id: visitId },
      {
        $push: { must_do_topics: sanitizedTopic },
        $set: { migratedAt: new Date() },
      }
    );
    await invalidateCompanyDetailCache(companyId);
  }
}
