import { roundTypeImpliesCodeExecutionInterview } from "../services/interviewCodeGradingGuards.js";

const toSafeString = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * Bank / generateQuestion fields to persist on a session question slot at creation time.
 */
export function buildResolvedFieldsForQuestionSlot(gen = {}) {
  const out = {};
  if (Array.isArray(gen.resolvedCodeTestCases) && gen.resolvedCodeTestCases.length > 0) {
    out.resolvedCodeTestCases = gen.resolvedCodeTestCases;
  }
  if (gen.resolvedDsaMetadata && typeof gen.resolvedDsaMetadata === "object") {
    out.resolvedDsaMetadata = gen.resolvedDsaMetadata;
  }
  if (Array.isArray(gen.resolvedTopics)) {
    out.resolvedTopics = gen.resolvedTopics;
  }
  if (Array.isArray(gen.resolvedSubtopics)) {
    out.resolvedSubtopics = gen.resolvedSubtopics;
  }
  if (Array.isArray(gen.resolvedCompanyTags)) {
    out.resolvedCompanyTags = gen.resolvedCompanyTags;
  }
  if (gen.resolvedComplexity && typeof gen.resolvedComplexity === "object") {
    out.resolvedComplexity = gen.resolvedComplexity;
  }
  return out;
}

/** Normalize slot snapshot into the shape expected by interview-status / run-preview. */
export function buildQuestionDisplayFromSlot(slot) {
  if (!slot || typeof slot !== "object") return null;
  return {
    questionId: toSafeString(slot.questionId),
    question: toSafeString(slot.question),
    url: toSafeString(slot.questionUrl),
    testCases: Array.isArray(slot.resolvedCodeTestCases) ? slot.resolvedCodeTestCases : [],
    dsaMetadata:
      slot.resolvedDsaMetadata && typeof slot.resolvedDsaMetadata === "object"
        ? slot.resolvedDsaMetadata
        : {},
    topics: Array.isArray(slot.resolvedTopics) ? slot.resolvedTopics : [],
    subtopics: Array.isArray(slot.resolvedSubtopics) ? slot.resolvedSubtopics : [],
    companyTags: Array.isArray(slot.resolvedCompanyTags) ? slot.resolvedCompanyTags : [],
    complexity:
      slot.resolvedComplexity && typeof slot.resolvedComplexity === "object"
        ? slot.resolvedComplexity
        : null,
  };
}

function isCodeExecutionSlot(slot, roundType) {
  const strat = toSafeString(slot?.evaluationStrategy).toLowerCase();
  return strat === "code_execution" || roundTypeImpliesCodeExecutionInterview(roundType);
}

function slotHasCodeDisplaySnapshot(slot) {
  const tests = Array.isArray(slot?.resolvedCodeTestCases) ? slot.resolvedCodeTestCases : [];
  const sig = toSafeString(slot?.resolvedDsaMetadata?.functionSignature);
  return tests.length > 0 && Boolean(sig);
}

/**
 * True when interview-status / run-preview must still query the question bank.
 */
export function slotNeedsBankQuestionLookup(slot, roundType = "") {
  if (!slot || typeof slot !== "object") return true;

  if (slot.sourceType === "generated" && !toSafeString(slot.questionId)) {
    return false;
  }

  if (isCodeExecutionSlot(slot, roundType)) {
    return !slotHasCodeDisplaySnapshot(slot);
  }

  if (toSafeString(slot.questionId) && Array.isArray(slot.resolvedTopics)) {
    return false;
  }

  return Boolean(toSafeString(slot.questionId));
}

/** Prefer slot snapshots; fill gaps from a bank row (legacy sessions). */
export function mergeQuestionDisplayPreferSlot(slotDisplay, bankDoc) {
  const slot = slotDisplay && typeof slotDisplay === "object" ? slotDisplay : {};
  const bank = bankDoc && typeof bankDoc === "object" ? bankDoc : {};
  return {
    questionId: toSafeString(slot.questionId) || toSafeString(bank.questionId),
    question: toSafeString(slot.question) || toSafeString(bank.question),
    url: toSafeString(slot.url) || toSafeString(bank.url),
    testCases:
      Array.isArray(slot.testCases) && slot.testCases.length > 0
        ? slot.testCases
        : Array.isArray(bank.testCases)
          ? bank.testCases
          : [],
    dsaMetadata:
      slot.dsaMetadata && Object.keys(slot.dsaMetadata).length > 0
        ? slot.dsaMetadata
        : bank.dsaMetadata && typeof bank.dsaMetadata === "object"
          ? bank.dsaMetadata
          : {},
    topics:
      Array.isArray(slot.topics) && slot.topics.length > 0
        ? slot.topics
        : Array.isArray(bank.topics)
          ? bank.topics
          : [],
    subtopics:
      Array.isArray(slot.subtopics) && slot.subtopics.length > 0
        ? slot.subtopics
        : Array.isArray(bank.subtopics)
          ? bank.subtopics
          : [],
    companyTags:
      Array.isArray(slot.companyTags) && slot.companyTags.length > 0
        ? slot.companyTags
        : Array.isArray(bank.companyTags)
          ? bank.companyTags
          : [],
    complexity: slot.complexity || bank.complexity || null,
  };
}
