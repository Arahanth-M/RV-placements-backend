import InterviewQuestion from "../models/InterviewQuestion.js";
import { normalizeExpectedPoints } from "./mcp/generateQuestion.js";
import { bankDocSatisfiesCodeGrading, cloneSerializable } from "./interviewCodeGradingGuards.js";
import { dedupeTestCases } from "../utils/dedupeTestCases.js";
import { normalizeMcqBankDoc } from "../utils/normalizeMcqBankDoc.js";
import { isCsFundamentalsRoundType } from "../utils/csFundamentalsRoundPlan.js";

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const normalizeDifficulty = (value) => {
  const safe = toSafeString(value, "medium").toLowerCase();
  return safe === "easy" || safe === "medium" || safe === "hard" ? safe : "medium";
};

const normalizeStringList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => toSafeString(item)).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,;|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const inferExpectedAnswerMode = ({ roundType, evaluationStrategy, rubric = [], mcqMetadata }) => {
  if (mcqMetadata || toSafeString(evaluationStrategy).toLowerCase() === "mcq_exact") {
    return "mcq";
  }

  const explicitMode = toSafeString(rubric?.[0]?.expectedAnswerMode);
  if (explicitMode) return explicitMode;

  if (evaluationStrategy === "code_execution") {
    return "code";
  }
  if (evaluationStrategy === "behavioral_llm") {
    return "story";
  }
  if (evaluationStrategy === "rubric_llm" && toSafeString(roundType).toLowerCase().includes("system")) {
    return "design";
  }

  const rt = toSafeString(roundType).toLowerCase();
  if (rt.includes("dsa")) return "code";
  if (rt.includes("sql")) return "conceptual";
  if (rt.includes("system")) return "design";
  if (rt.includes("hr")) return "story";
  return "conceptual";
};

const normalizeExclusions = (values = []) => {
  if (!Array.isArray(values)) return [];
  return values.map((value) => toSafeString(value)).filter(Boolean);
};

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildRoundTypeMatcher = (roundType) => {
  const rt = toSafeString(roundType).toLowerCase();
  if (!rt) return null;

  if (
    rt.includes("dsa") ||
    rt.includes("coding") ||
    rt.includes("algorithm") ||
    rt.includes("data structure") ||
    rt.includes("programming") ||
    rt.includes("technical") ||
    rt.includes("software") ||
    rt.includes("developer") ||
    rt.includes("leetcode")
  ) {
    return { $regex: "(dsa|coding|algorithm|data\\s*structure)", $options: "i" };
  }
  if (rt.includes("sql") || rt.includes("database") || rt.includes("dbms")) {
    return { $regex: "(sql|database|dbms)", $options: "i" };
  }
  if (rt.includes("system")) {
    return { $regex: "system\\s*design", $options: "i" };
  }
  if (rt.includes("hr") || rt.includes("behavior")) {
    return { $regex: "(hr|behavior)", $options: "i" };
  }

  return { $regex: `^${escapeRegex(toSafeString(roundType))}$`, $options: "i" };
};

const isCsFundamentalsRound = (roundType) => isCsFundamentalsRoundType(roundType);

const docPassesBankFilter = (roundType, doc, questionKind = null) => {
  const strat = toSafeString(doc?.evaluationStrategy).toLowerCase();

  if (questionKind === "mcq") {
    return strat === "mcq_exact" && normalizeMcqBankDoc(doc) != null;
  }

  if (questionKind === "theory") {
    if (strat === "mcq_exact" || strat === "code_execution" || strat === "sql_execution") {
      return false;
    }
    return bankDocSatisfiesCodeGrading(roundType, doc);
  }

  if (strat === "mcq_exact") {
    return normalizeMcqBankDoc(doc) != null;
  }
  return bankDocSatisfiesCodeGrading(roundType, doc);
};

const pickTopQuestions = async (match, limit = 1) => {
  const lim = Math.max(1, Math.min(40, Number(limit) || 1));
  return InterviewQuestion.aggregate([
    { $match: match },
    {
      $addFields: {
        _verifiedRank: {
          $cond: [
            {
              $or: [
                { $eq: ["$sourceMetadata.verified", true] },
                { $eq: ["$verified", true] },
              ],
            },
            1,
            0,
          ],
        },
        _qualityRank: {
          $ifNull: [
            "$sourceMetadata.qualityScore",
            { $ifNull: ["$qualityScore", 0] },
          ],
        },
        _randomTieBreaker: { $rand: {} },
      },
    },
    {
      $sort: {
        _verifiedRank: -1,
        _qualityRank: -1,
        _randomTieBreaker: -1,
      },
    },
    { $limit: lim },
    {
      $project: {
        _verifiedRank: 0,
        _qualityRank: 0,
        _randomTieBreaker: 0,
      },
    },
  ]);
};

/**
 * Retrieval-first question selector.
 * Returns one question normalized to the generateQuestion contract + retrieval metadata.
 */
export async function retrieveQuestion({
  company,
  roundType,
  difficulty,
  excludedQuestionIds = [],
  questionKind = null,
}) {
  const companyTag = toSafeString(company);
  const normalizedRoundType = toSafeString(roundType);
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  const exclusions = normalizeExclusions(excludedQuestionIds);
  const roundTypeMatcher = buildRoundTypeMatcher(normalizedRoundType);

  if (!normalizedRoundType || !roundTypeMatcher) {
    return null;
  }

  const baseMatch = {
    roundType: roundTypeMatcher,
    difficulty: normalizedDifficulty,
  };
  if (exclusions.length > 0) baseMatch.questionId = { $nin: exclusions };

  const candidateMatches = [];
  const normalizedQuestionKind = toSafeString(questionKind).toLowerCase();

  if (normalizedQuestionKind === "mcq") {
    candidateMatches.push({
      ...baseMatch,
      evaluationStrategy: "mcq_exact",
    });
    candidateMatches.push({
      roundType: roundTypeMatcher,
      evaluationStrategy: "mcq_exact",
    });
  } else if (normalizedQuestionKind === "theory") {
    if (companyTag) {
      candidateMatches.push({
        ...baseMatch,
        companyTags: companyTag,
        evaluationStrategy: "rubric_llm",
      });
      candidateMatches.push({
        roundType: roundTypeMatcher,
        companyTags: companyTag,
        evaluationStrategy: "rubric_llm",
      });
    }
    candidateMatches.push({ ...baseMatch, evaluationStrategy: "rubric_llm" });
    candidateMatches.push({ roundType: roundTypeMatcher, evaluationStrategy: "rubric_llm" });
    candidateMatches.push({
      ...baseMatch,
      evaluationStrategy: { $nin: ["mcq_exact", "code_execution", "sql_execution"] },
    });
    candidateMatches.push({
      roundType: roundTypeMatcher,
      evaluationStrategy: { $nin: ["mcq_exact", "code_execution", "sql_execution"] },
    });
  } else if (isCsFundamentalsRound(normalizedRoundType)) {
    candidateMatches.push({
      ...baseMatch,
      evaluationStrategy: "mcq_exact",
    });
    candidateMatches.push({
      roundType: roundTypeMatcher,
      evaluationStrategy: "mcq_exact",
    });
  }

  if (!normalizedQuestionKind || normalizedQuestionKind === "theory") {
    if (companyTag) {
      candidateMatches.push({ ...baseMatch, companyTags: companyTag });
      candidateMatches.push({ roundType: roundTypeMatcher, companyTags: companyTag });
    }
    if (!normalizedQuestionKind) {
      candidateMatches.push(baseMatch);
      candidateMatches.push({ roundType: roundTypeMatcher });
    }
  }

  let selected = null;

  for (const match of candidateMatches) {
    const batch = await pickTopQuestions(match, 24);
    selected = batch.find((doc) => docPassesBankFilter(normalizedRoundType, doc, normalizedQuestionKind || null)) || null;
    if (selected) break;
  }

  if (!selected) {
    return null;
  }

  const resolvedMcqMetadata = normalizeMcqBankDoc(selected);
  const isMcq = resolvedMcqMetadata != null;

  const expectedAnswerMode = inferExpectedAnswerMode({
    roundType: selected.roundType,
    evaluationStrategy: isMcq ? "mcq_exact" : selected.evaluationStrategy,
    rubric: selected.rubric,
    mcqMetadata: resolvedMcqMetadata,
  });

  const expectedPoints = isMcq
    ? []
    : normalizeExpectedPoints(selected.rubric, {
        roundType: selected.roundType,
        expectedAnswerMode,
      });

  const rawTests = dedupeTestCases(Array.isArray(selected.testCases) ? selected.testCases : []);

  return {
    question: toSafeString(selected.question),
    expectedAnswerMode,
    expectedPoints,
    questionId: toSafeString(selected.questionId),
    evaluationStrategy: isMcq
      ? "mcq_exact"
      : toSafeString(selected.evaluationStrategy),
    resolvedMcqMetadata: resolvedMcqMetadata || undefined,
    testCases: cloneSerializable(rawTests) || [],
    metadata: {
      title: toSafeString(selected.title),
      url: toSafeString(selected.url),
      companyTags: Array.isArray(selected.companyTags) ? selected.companyTags : [],
      roundType: toSafeString(selected.roundType),
      difficulty: toSafeString(selected.difficulty),
      topics: normalizeStringList(selected.topics),
      subtopics: normalizeStringList(selected.subtopics),
      dsaMetadata: selected.dsaMetadata || {},
      sqlMetadata: selected.sqlMetadata || {},
      systemDesignMetadata: selected.systemDesignMetadata || {},
      hrMetadata: selected.hrMetadata || {},
      complexity: selected.complexity || {},
      sourceMetadata: selected.sourceMetadata || {},
    },
  };
}

export default retrieveQuestion;
