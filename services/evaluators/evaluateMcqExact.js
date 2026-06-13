import { parseMcqSelectedOptionId } from "../../utils/normalizeMcqBankDoc.js";

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

/**
 * Deterministic MCQ grading — exact option match only.
 */
export async function evaluateMcqExact({ answer, question, mcqMetadata, metadata }) {
  const meta =
    mcqMetadata && typeof mcqMetadata === "object"
      ? mcqMetadata
      : metadata?.mcqMetadata && typeof metadata.mcqMetadata === "object"
        ? metadata.mcqMetadata
        : null;

  const correctOptionId = toSafeString(meta?.correctOptionId).toUpperCase();
  const selectedOptionId = parseMcqSelectedOptionId(answer);
  const explanation = toSafeString(meta?.explanation);
  const options = Array.isArray(meta?.options) ? meta.options : [];
  const selectedOption = options.find(
    (opt) => toSafeString(opt?.id).toUpperCase() === selectedOptionId
  );
  const correctOption = options.find(
    (opt) => toSafeString(opt?.id).toUpperCase() === correctOptionId
  );

  if (!correctOptionId) {
    return {
      score: null,
      type: "mcq",
      feedback: "This MCQ could not be graded (missing correct answer key).",
      verdict: "incorrect",
      evaluationTrace: {
        scoringVersion: "mcq_exact_v1",
        questionType: "mcq",
        expectedAnswerMode: "mcq",
        verdict: "incorrect",
        confidence: 0,
        relevance: 0,
        coverage: 0,
        correctness: 0,
        communication: 0,
        matchedRubricPoints: [],
        missingRubricPoints: [],
        criticalMisses: ["missing_correct_option"],
        subscores: {},
        mcq: { selectedOptionId: selectedOptionId || null, correctOptionId: null },
      },
    };
  }

  if (!selectedOptionId) {
    return {
      score: 1,
      type: "mcq",
      feedback: "Please select one option before submitting.",
      verdict: "incorrect",
      evaluationTrace: {
        scoringVersion: "mcq_exact_v1",
        questionType: "mcq",
        expectedAnswerMode: "mcq",
        verdict: "incorrect",
        confidence: 1,
        relevance: 0,
        coverage: 0,
        correctness: 0,
        communication: 0,
        matchedRubricPoints: [],
        missingRubricPoints: [`Correct answer: ${correctOptionId}`],
        criticalMisses: ["no_selection"],
        subscores: {},
        mcq: { selectedOptionId: null, correctOptionId },
      },
    };
  }

  const isCorrect = selectedOptionId === correctOptionId;
  const score = isCorrect ? 10 : 1;
  const verdict = isCorrect ? "correct" : "incorrect";
  const wrongReason = toSafeString(selectedOption?.distractorReason);
  const correctText = toSafeString(correctOption?.text);
  const selectedText = toSafeString(selectedOption?.text);

  let feedback;
  if (isCorrect) {
    feedback = explanation
      ? `Correct (${correctOptionId}). ${explanation}`
      : `Correct — option ${correctOptionId}.`;
  } else {
    feedback = `Incorrect. You selected ${selectedOptionId}. The correct answer is ${correctOptionId}${
      correctText ? ` (${correctText})` : ""
    }.`;
    if (wrongReason) {
      feedback += ` ${wrongReason}`;
    } else if (explanation) {
      feedback += ` ${explanation}`;
    }
  }

  const mcqTrace = {
    selectedOptionId,
    correctOptionId,
    selectedOptionText: selectedText,
    correctOptionText: correctText,
    reason: isCorrect ? "" : wrongReason,
    explanation,
  };

  return {
    score,
    type: "mcq",
    feedback,
    verdict,
    evaluationTrace: {
      scoringVersion: "mcq_exact_v1",
      questionType: "mcq",
      expectedAnswerMode: "mcq",
      verdict,
      confidence: 1,
      relevance: isCorrect ? 1 : 0,
      coverage: isCorrect ? 1 : 0,
      correctness: isCorrect ? 1 : 0,
      communication: 0,
      matchedRubricPoints: isCorrect ? [`Selected option ${correctOptionId}`] : [],
      missingRubricPoints: isCorrect ? [] : [`Correct option is ${correctOptionId}`],
      criticalMisses: isCorrect
        ? []
        : [`Selected ${selectedOptionId} instead of ${correctOptionId}`],
      subscores: { selection: isCorrect ? 1 : 0 },
      mcq: mcqTrace,
    },
  };
}

export default evaluateMcqExact;
